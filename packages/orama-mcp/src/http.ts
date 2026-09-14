import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { createLogger } from "./util/log";

const log = createLogger("http");

/** Bodies are JSON-RPC messages, not uploads. Cap rather than buffer unboundedly. */
const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Upper bound on tracked sessions. A well-behaved client DELETEs its session on
 * shutdown, but the MCP client SDK's close() does not and a killed process cannot,
 * so leaked sessions are the norm rather than the exception. Evicting the
 * least-recently-*active* one caps the leak without reaping live-but-idle sessions
 * (an agent session can sit idle for hours and still be in use). */
const DEFAULT_MAX_SESSIONS = 256;

export interface HttpServerOptions {
  host: string;
  port: number;
  /** Path the MCP endpoint is served on, e.g. "/mcp". */
  path: string;
  /** Per-session MCP protocol shell. Everything expensive (the engine, the
   * embedder, the file watcher) must be built once by the caller and captured
   * here -- that sharing is the entire point of the HTTP transport. */
  createMcpServer: () => McpServer;
  /** Reported by /healthz, for readiness checks and debugging. */
  root: string;
  fileCount: () => number;
  maxSessions?: number;
}

export interface RunningHttpServer {
  host: string;
  /** The port actually bound (differs from the requested one when that was 0). */
  port: number;
  url: string;
  sessionCount: () => number;
  close: () => Promise<void>;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

function jsonError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

/** The MCP session id, or undefined if the header is absent, empty, or repeated.
 * Node joins duplicate headers with ", "; an ambiguous or blank id is treated as
 * ABSENT (so an initialize POST still mints a session) rather than as an unknown
 * one (which would 404 a perfectly valid handshake). */
function sessionIdOf(req: IncomingMessage): string | undefined {
  const raw = req.headers["mcp-session-id"];
  const value = Array.isArray(raw) ? (raw.length === 1 ? raw[0] : undefined) : raw;
  if (value === undefined || value.includes(",")) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

type BodyResult = { ok: true; body: unknown } | { ok: false; status: number; message: string };

function readBody(req: IncomingMessage): Promise<BodyResult> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (result: BodyResult): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.pause();
        finish({ ok: false, status: 413, message: `Payload Too Large: body exceeds ${MAX_BODY_BYTES} bytes` });
        return;
      }
      chunks.push(chunk);
    });
    req.on("error", (err) => finish({ ok: false, status: 400, message: `Bad Request: ${err.message}` }));
    req.on("end", () => {
      try {
        finish({ ok: true, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
      } catch {
        finish({ ok: false, status: 400, message: "Bad Request: body is not valid JSON" });
      }
    });
  });
}

export async function startHttpServer(opts: HttpServerOptions): Promise<RunningHttpServer> {
  const maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
  /** Insertion order doubles as recency: `touch` re-inserts, so the first entry
   * is always the least-recently-active session. */
  const sessions = new Map<string, Session>();
  /** Filled in after listen(): pinned to the port we actually BOUND, which is not
   * the requested one when that was 0. */
  let allowedHosts: string[] = [];

  const touch = (id: string, session: Session): void => {
    sessions.delete(id);
    sessions.set(id, session);
  };

  const closeSession = async (session: Session): Promise<void> => {
    // McpServer.close() closes the transport it is connected to.
    await session.server.close().catch((err: unknown) => {
      log.warn("failed to close session", { message: (err as Error).message });
    });
  };

  const register = (id: string, session: Session): void => {
    while (sessions.size >= maxSessions) {
      const oldest = sessions.entries().next();
      if (oldest.done) break;
      const [oldestId, oldestSession] = oldest.value;
      sessions.delete(oldestId);
      log.warn("session limit reached, evicting least-recently-active session", { evicted: oldestId, maxSessions });
      void closeSession(oldestSession);
    }
    sessions.set(id, session);
    log.info("session opened", { sessionId: id, sessions: sessions.size });
  };

  async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const id = sessionIdOf(req);
    // An ambiguous header must not reach the SDK's own session validation either.
    if (id === undefined) delete req.headers["mcp-session-id"];

    if (id !== undefined) {
      const session = sessions.get(id);
      if (!session) {
        // 404 is load-bearing: it is what tells a spec-compliant client to
        // re-initialize instead of retrying a session we no longer have.
        jsonError(res, 404, -32001, "Session not found");
        return;
      }
      touch(id, session);
      if (req.method === "POST") {
        const body = await readBody(req);
        if (!body.ok) {
          jsonError(res, body.status, -32000, body.message);
          return;
        }
        await session.transport.handleRequest(req, res, body.body);
        return;
      }
      await session.transport.handleRequest(req, res);
      return;
    }

    if (req.method !== "POST") {
      jsonError(res, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
      return;
    }

    const body = await readBody(req);
    if (!body.ok) {
      jsonError(res, body.status, -32000, body.message);
      return;
    }
    if (!(Array.isArray(body.body) ? body.body.some(isInitializeRequest) : isInitializeRequest(body.body))) {
      jsonError(res, 400, -32000, "Bad Request: Mcp-Session-Id header is required");
      return;
    }

    // A fresh McpServer per session is not optional: the SDK's Server holds a
    // single _transport, so one instance cannot serve two concurrent clients.
    // It is only a protocol shell -- the engine behind it is shared.
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      enableDnsRebindingProtection: true,
      allowedHosts,
      onsessioninitialized: (newId) => register(newId, session),
      onsessionclosed: (closedId) => {
        // The transport closes itself right after this; just drop our handle.
        sessions.delete(closedId);
        log.info("session closed", { sessionId: closedId, sessions: sessions.size });
      },
    });
    const session: Session = { transport, server: opts.createMcpServer() };
    await session.server.connect(transport);
    await transport.handleRequest(req, res, body.body);
    if (transport.sessionId === undefined) {
      // Initialize was rejected (bad Host, malformed message, ...) -- don't leak
      // the shell we speculatively built for it.
      await closeSession(session);
    }
  }

  const httpServer = createServer((req, res) => {
    const pathname = (req.url ?? "/").split("?")[0] ?? "/";

    if (pathname === "/healthz") {
      const payload = { status: "ok", sessions: sessions.size, root: opts.root, files: opts.fileCount() };
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(payload));
      return;
    }

    if (pathname !== opts.path) {
      jsonError(res, 404, -32000, `Not Found: no MCP endpoint at ${pathname}`);
      return;
    }

    void handleMcp(req, res).catch((err: unknown) => {
      log.error("request failed", { message: (err as Error).message });
      if (!res.headersSent) jsonError(res, 500, -32603, "Internal server error");
      else res.end();
    });
  });

  await new Promise<void>((resolve, reject) => {
    const onListenError = (err: Error): void => reject(err);
    httpServer.once("error", onListenError);
    httpServer.listen(opts.port, opts.host, () => {
      httpServer.removeListener("error", onListenError);
      resolve();
    });
  });

  const address = httpServer.address();
  const boundPort = typeof address === "object" && address !== null ? address.port : opts.port;
  // DNS rebinding protection: binding to loopback does NOT stop a browser page on
  // this machine being pointed at 127.0.0.1, but pinning the Host header does.
  // Derive it from the port we BOUND -- with --port 0, pinning the literal 0
  // would reject every request.
  allowedHosts = [
    `${opts.host}:${boundPort}`,
    `127.0.0.1:${boundPort}`,
    `localhost:${boundPort}`,
    `[::1]:${boundPort}`,
  ];

  // The listen-time handler above is one-shot (it rejects the bind promise).
  // Without a standing one, a later socket error is an unhandled 'error' event
  // and takes down the server every session shares.
  httpServer.on("error", (err) => log.error("server error", { message: err.message }));

  return {
    host: opts.host,
    port: boundPort,
    url: `http://${opts.host}:${boundPort}${opts.path}`,
    sessionCount: () => sessions.size,
    close: async () => {
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.allSettled(open.map(closeSession));
      await new Promise<void>((resolve) => {
        httpServer.close(() => resolve());
        // Must come after close() (which stops accepting) but BEFORE we await it:
        // keep-alive sockets would otherwise hold it open indefinitely.
        httpServer.closeAllConnections();
      });
    },
  };
}
