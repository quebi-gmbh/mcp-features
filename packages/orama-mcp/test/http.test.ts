import { afterEach, describe, expect, test } from "bun:test";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { startHttpServer, type RunningHttpServer } from "../src/http";

const PROTOCOL_VERSION = "2025-06-18";
const MCP_ACCEPT = "application/json, text/event-stream";

/** Stand-in for the expensive shared state (KnowledgeEngine + embedder + watcher):
 * built once per harness, outside the per-session factory. */
interface FakeEngine {
  id: string;
  calls: number;
  files: number;
}

interface Harness {
  server: RunningHttpServer;
  engine: FakeEngine;
  /** How many times the per-session McpServer factory ran. */
  factoryCalls: () => number;
}

const started: RunningHttpServer[] = [];

async function startHarness(opts: { maxSessions?: number } = {}): Promise<Harness> {
  const engine: FakeEngine = { id: `engine-${Math.random().toString(36).slice(2)}`, calls: 0, files: 3 };
  let factoryCalls = 0;

  const server = await startHttpServer({
    host: "127.0.0.1",
    port: 0,
    path: "/mcp",
    root: "/tmp/orama-http-test",
    fileCount: () => engine.files,
    maxSessions: opts.maxSessions,
    createMcpServer: () => {
      factoryCalls++;
      const mcp = new McpServer({ name: "orama-mcp-test", version: "0.0.0" });
      mcp.tool("search_knowledge", "test search", { query: z.string() }, async ({ query }) => {
        engine.calls++;
        return { content: [{ type: "text" as const, text: `${engine.id}:${query}:${engine.calls}` }] };
      });
      return mcp;
    },
  });
  started.push(server);
  return { server, engine, factoryCalls: () => factoryCalls };
}

async function connectClient(harness: Harness): Promise<{ client: Client; sessionId: string | undefined }> {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(harness.server.url));
  await client.connect(transport);
  return { client, sessionId: transport.sessionId };
}

interface RawResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

/** node:http rather than fetch: the Host header has to be settable (fetch pins it
 * to the URL) for the DNS-rebinding test. */
function raw(
  server: RunningHttpServer,
  opts: { method: string; path?: string; headers?: Record<string, string>; body?: unknown },
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const payload = opts.body === undefined ? undefined : JSON.stringify(opts.body);
    const req = request(
      {
        host: "127.0.0.1",
        port: server.port,
        path: opts.path ?? "/mcp",
        method: opts.method,
        headers: {
          accept: MCP_ACCEPT,
          ...(payload === undefined ? {} : { "content-type": "application/json" }),
          ...opts.headers,
        },
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => {
          body += chunk;
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    if (payload !== undefined) req.write(payload);
    req.end();
  });
}

function initializeBody(id = 1): unknown {
  return {
    jsonrpc: "2.0",
    id,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: "raw-client", version: "0.0.0" },
    },
  };
}

async function rawInitialize(server: RunningHttpServer): Promise<string> {
  const res = await raw(server, { method: "POST", body: initializeBody() });
  expect(res.status).toBe(200);
  const sessionId = res.headers["mcp-session-id"];
  expect(typeof sessionId).toBe("string");
  await raw(server, {
    method: "POST",
    headers: { "mcp-session-id": sessionId as string, "mcp-protocol-version": PROTOCOL_VERSION },
    body: { jsonrpc: "2.0", method: "notifications/initialized" },
  });
  return sessionId as string;
}

/** A cheap request that proves a session is still routable. */
function rawPing(server: RunningHttpServer, sessionId: string, id = 99): Promise<RawResponse> {
  return raw(server, {
    method: "POST",
    headers: { "mcp-session-id": sessionId, "mcp-protocol-version": PROTOCOL_VERSION },
    body: { jsonrpc: "2.0", id, method: "tools/list", params: {} },
  });
}

afterEach(async () => {
  await Promise.allSettled(started.splice(0).map((s) => s.close()));
});

describe("http transport", () => {
  test("completes a real handshake and serves a tool call", async () => {
    const harness = await startHarness();
    const { client, sessionId } = await connectClient(harness);

    expect(sessionId).toBeTruthy();
    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain("search_knowledge");

    const result = await client.callTool({ name: "search_knowledge", arguments: { query: "rollback" } });
    const content = result.content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain(`${harness.engine.id}:rollback`);

    await client.close();
  });

  test("two concurrent clients get distinct sessions but share one engine", async () => {
    const harness = await startHarness();
    const a = await connectClient(harness);
    const b = await connectClient(harness);

    expect(a.sessionId).toBeTruthy();
    expect(b.sessionId).toBeTruthy();
    expect(a.sessionId).not.toBe(b.sessionId);
    expect(harness.server.sessionCount()).toBe(2);

    // One protocol shell per session (the SDK's Server holds a single transport)...
    expect(harness.factoryCalls()).toBe(2);

    // ...but both shells answer out of the same engine instance.
    const resA = await a.client.callTool({ name: "search_knowledge", arguments: { query: "a" } });
    const resB = await b.client.callTool({ name: "search_knowledge", arguments: { query: "b" } });
    const textA = (resA.content as Array<{ text: string }>)[0]?.text ?? "";
    const textB = (resB.content as Array<{ text: string }>)[0]?.text ?? "";
    expect(textA).toBe(`${harness.engine.id}:a:1`);
    expect(textB).toBe(`${harness.engine.id}:b:2`);
    expect(harness.engine.calls).toBe(2);

    await a.client.close();
    await b.client.close();
  });

  test("closing one session leaves the other working", async () => {
    const harness = await startHarness();
    const a = await connectClient(harness);
    const b = await connectClient(harness);

    await a.client.close();
    await raw(harness.server, {
      method: "DELETE",
      headers: { "mcp-session-id": a.sessionId as string, "mcp-protocol-version": PROTOCOL_VERSION },
    });

    const result = await b.client.callTool({ name: "search_knowledge", arguments: { query: "still here" } });
    expect((result.content as Array<{ text: string }>)[0]?.text).toContain("still here");

    await b.client.close();
  });

  test("DELETE drops only the targeted session", async () => {
    const harness = await startHarness();
    const first = await rawInitialize(harness.server);
    const second = await rawInitialize(harness.server);
    expect(harness.server.sessionCount()).toBe(2);

    const deleted = await raw(harness.server, {
      method: "DELETE",
      headers: { "mcp-session-id": first, "mcp-protocol-version": PROTOCOL_VERSION },
    });
    expect(deleted.status).toBe(200);
    expect(harness.server.sessionCount()).toBe(1);

    expect((await rawPing(harness.server, first)).status).toBe(404);
    expect((await rawPing(harness.server, second)).status).toBe(200);
  });

  test("/healthz reports status, session count, root and file count", async () => {
    const harness = await startHarness();
    const before = await raw(harness.server, { method: "GET", path: "/healthz" });
    expect(before.status).toBe(200);
    expect(JSON.parse(before.body)).toEqual({
      status: "ok",
      sessions: 0,
      root: "/tmp/orama-http-test",
      files: 3,
    });

    const { client } = await connectClient(harness);
    const after = await raw(harness.server, { method: "GET", path: "/healthz" });
    expect(JSON.parse(after.body).sessions).toBe(1);
    await client.close();
  });

  test("unknown path is a 404", async () => {
    const harness = await startHarness();
    const res = await raw(harness.server, { method: "POST", path: "/nope", body: initializeBody() });
    expect(res.status).toBe(404);
  });

  test("non-initialize POST with no session id is a 400", async () => {
    const harness = await startHarness();
    const res = await raw(harness.server, {
      method: "POST",
      body: { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} },
    });
    expect(res.status).toBe(400);
    expect(harness.server.sessionCount()).toBe(0);
  });

  test("an empty or repeated session header counts as absent, not unknown", async () => {
    const harness = await startHarness();

    // Empty: an initialize POST still mints a session rather than 404ing.
    const empty = await raw(harness.server, {
      method: "POST",
      headers: { "mcp-session-id": "" },
      body: initializeBody(),
    });
    expect(empty.status).toBe(200);
    expect(empty.headers["mcp-session-id"]).toBeTruthy();

    // Repeated (node joins duplicates with ", "): same treatment.
    const repeated = await raw(harness.server, {
      method: "POST",
      headers: { "mcp-session-id": "one, two" },
      body: initializeBody(2),
    });
    expect(repeated.status).toBe(200);
    expect(repeated.headers["mcp-session-id"]).toBeTruthy();
    expect(repeated.headers["mcp-session-id"]).not.toBe("one, two");
  });

  test("a stale session id is a 404 so the client re-initializes", async () => {
    const harness = await startHarness();
    const res = await rawPing(harness.server, "11111111-2222-3333-4444-555555555555");
    expect(res.status).toBe(404);
  });

  test("a foreign Host header is rejected (DNS rebinding protection)", async () => {
    const harness = await startHarness();
    const res = await raw(harness.server, {
      method: "POST",
      headers: { host: "evil.example.com" },
      body: initializeBody(),
    });
    expect(res.status).toBe(403);
    // The speculative session shell must not linger after a rejected initialize.
    expect(harness.server.sessionCount()).toBe(0);
  });

  test("accepts localhost and [::1] Host headers on the bound port", async () => {
    const harness = await startHarness();
    for (const host of [`localhost:${harness.server.port}`, `[::1]:${harness.server.port}`]) {
      const res = await raw(harness.server, { method: "POST", headers: { host }, body: initializeBody() });
      expect(res.status).toBe(200);
    }
  });

  test("evicts the least-recently-active session past maxSessions", async () => {
    const harness = await startHarness({ maxSessions: 2 });
    const first = await rawInitialize(harness.server);
    const second = await rawInitialize(harness.server);

    // Touch `first` so `second` becomes the least-recently-active one. Recency is
    // activity, not age: an idle-but-live agent session must not be reaped.
    expect((await rawPing(harness.server, first)).status).toBe(200);

    const third = await rawInitialize(harness.server);
    expect(harness.server.sessionCount()).toBe(2);

    expect((await rawPing(harness.server, second)).status).toBe(404);
    expect((await rawPing(harness.server, first)).status).toBe(200);
    expect((await rawPing(harness.server, third)).status).toBe(200);
  });
});
