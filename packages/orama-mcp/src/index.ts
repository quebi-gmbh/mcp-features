#!/usr/bin/env bun
/**
 * orama-mcp — stdio MCP server exposing hybrid search over the workspace's
 * Markdown and JSONL files.
 *
 * ┌─ SCAFFOLD ────────────────────────────────────────────────────────────────┐
 * │ This is an intentionally minimal entrypoint. See ./README.md "Build plan". │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Intended shape:
 *
 *   1. Parse args:   --globs "**\/*.md,**\/*.jsonl"  --root <cwd>  --cache .orama-cache
 *   2. Build index:  create an Orama schema (text + embedding + metadata), then
 *                    - Markdown adapter: header-based chunking -> one doc per section
 *                    - JSONL adapter:    one line -> one doc (expects a `text`/`content` field)
 *   3. Embed:        local model (fastembed-js / transformers.js), cached on disk by
 *                    content_hash so restarts only re-embed changed chunks.
 *   4. Watch:        chokidar on the globs -> insert/update/remove docs live.
 *   5. Serve (stdio): register MCP tools:
 *                       - search_knowledge(query, k?, filter?)  -> hybrid BM25 + vector
 *                       - get_document(path)                    -> full source of a file
 *                       - list_sources()                        -> indexed files + counts
 *                    Each hit returns { path, heading, snippet, score }.
 *
 * Keep it a pure function of the local files: no network, no external store.
 */

async function main(): Promise<void> {
  // TODO: replace this stub with the server described above.
  process.stderr.write(
    "orama-mcp: scaffold only — not implemented yet. See packages/orama-mcp/README.md\n",
  );
  process.exit(1);
}

void main();
