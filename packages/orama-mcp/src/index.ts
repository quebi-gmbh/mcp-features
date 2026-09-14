#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../package.json";
import { parseConfig } from "./config";
import { KnowledgeEngine } from "./engine";
import { startHttpServer } from "./http";
import { registerTools } from "./mcp/tools";
import { createLogger } from "./util/log";
import { startWatcher } from "./watcher";

const log = createLogger("orama-mcp");

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));

  // Everything expensive is built exactly once, here, and shared by every client
  // the process serves: the index, the embedding model behind it, and the one
  // chokidar watcher keeping them live.
  const engine = new KnowledgeEngine(config.cacheDir);
  const cacheDirName = config.cacheDir.slice(config.root.length + 1);
  const stopWatcher = startWatcher(config.root, config.globs, engine, {
    cacheDir: config.cacheDir,
    cacheDirName,
    ocr: config.ocr,
  });

  // Per connected client the SDK needs its own Server instance (it holds a single
  // _transport), but that instance is only a protocol shell over the shared engine.
  const createMcpServer = (): McpServer => {
    const server = new McpServer({ name: "orama-mcp", version: pkg.version });
    registerTools(server, engine, config.root);
    return server;
  };

  let shuttingDown = false;
  const shutdown = async (closeTransport: () => Promise<void>): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await stopWatcher();
    await closeTransport();
    process.exit(0);
  };

  if (config.transport === "http") {
    const http = await startHttpServer({
      host: config.host,
      port: config.port,
      path: config.path,
      createMcpServer,
      root: config.root,
      fileCount: () => engine.listSources().length,
    });
    log.info("orama-mcp ready", { transport: "http", url: http.url, root: config.root, globs: config.globs });
    const stop = (): void => void shutdown(() => http.close());
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    // Deliberately no stdin-'end' shutdown here: in HTTP mode no single client
    // owns this process, and it is meant to outlive all of them.
    return;
  }

  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("orama-mcp ready", { transport: "stdio", root: config.root, globs: config.globs });

  const stop = (): void => void shutdown(() => server.close());
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  // The MCP client owns our stdin; when it closes the pipe, the session is over.
  process.stdin.on("end", stop);
}

void main().catch((err: unknown) => {
  if ((err as NodeJS.ErrnoException)?.code === "EADDRINUSE") {
    // One shared server per container is the intended end state, so losing the
    // race to start it is success, not failure.
    log.info("address already in use; another orama-mcp is already serving it");
    process.exit(0);
  }
  log.error("failed to start", { message: (err as Error)?.message ?? String(err) });
  process.exit(1);
});
