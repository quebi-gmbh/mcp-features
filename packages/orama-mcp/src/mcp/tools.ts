import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { KnowledgeEngine } from "../engine";

function textResult(text: string): CallToolResult {
  return { content: [{ type: "text", text }] };
}

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

export function registerTools(server: McpServer, engine: KnowledgeEngine, root: string): void {
  server.tool(
    "search_knowledge",
    "Hybrid (BM25 + vector) search over indexed Markdown, JSONL, and PDF knowledge files.",
    {
      query: z.string().describe("Natural-language or keyword search query"),
      k: z.number().int().optional().default(10).describe("Max results to return"),
      path: z.string().optional().describe("Restrict results to this indexed file path"),
      source: z.enum(["markdown", "jsonl", "pdf"]).optional().describe("Restrict results to this source type"),
    },
    async ({ query, k, path, source }): Promise<CallToolResult> => {
      const hits = await engine.search(query, k, { path, source });
      if (hits.length === 0) return textResult("No results.");
      const text = hits
        .map((h) => `${h.path}${h.heading ? ` — ${h.heading}` : ""} (score ${h.score.toFixed(3)})\n${h.snippet}`)
        .join("\n\n");
      return textResult(text);
    },
  );

  server.tool(
    "get_document",
    "Read the full source text of an indexed file.",
    { path: z.string().describe("Path of an indexed file, as returned by search_knowledge/list_sources") },
    async ({ path }): Promise<CallToolResult> => {
      if (!engine.hasSource(path)) {
        return errorResult(`'${path}' is not an indexed file. Call list_sources to see what's indexed.`);
      }
      // PDFs have no readable-on-disk text; serve the extracted/indexed text instead.
      // For text sources, read the file for full fidelity (chunking may drop noise).
      const text = path.endsWith(".pdf")
        ? (engine.documentText(path) ?? "")
        : readFileSync(resolve(root, path), "utf8");
      return textResult(text);
    },
  );

  server.tool(
    "list_sources",
    "List indexed files and their chunk counts.",
    {},
    async (): Promise<CallToolResult> => {
      const sources = engine.listSources();
      if (sources.length === 0) return textResult("No files indexed yet.");
      return textResult(sources.map((s) => `${s.path} (${s.chunks} chunk${s.chunks === 1 ? "" : "s"})`).join("\n"));
    },
  );
}
