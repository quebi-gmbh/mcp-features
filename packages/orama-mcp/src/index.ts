#!/usr/bin/env bun
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import pkg from "../package.json";
import { parseConfig } from "./config";
import { KnowledgeEngine } from "./engine";
import { registerTools } from "./mcp/tools";
import { createLogger } from "./util/log";
import { startWatcher } from "./watcher";

const log = createLogger("orama-mcp");

async function main(): Promise<void> {
  const config = parseConfig(process.argv.slice(2));
  const engine = new KnowledgeEngine(config.cacheDir);

  const server = new McpServer({ name: "orama-mcp", version: pkg.version });
  registerTools(server, engine, config.root);

  const cacheDirName = config.cacheDir.slice(config.root.length + 1);
  const stopWatcher = startWatcher(config.root, config.globs, engine, {
    cacheDir: config.cacheDir,
    cacheDirName,
    ocr: config.ocr,
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  log.info("orama-mcp ready", { root: config.root, globs: config.globs });

  let shuttingDown = false;
  const shutdown = async (): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    await stopWatcher();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
  // The MCP client owns our stdin; when it closes the pipe, the session is over.
  process.stdin.on("end", () => void shutdown());
}

void main();
