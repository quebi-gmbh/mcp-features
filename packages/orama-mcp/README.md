# @quebi/orama-mcp

A **stdio MCP server** that indexes every **Markdown** and **JSONL** file in the workspace with
[Orama](https://github.com/oramasearch/orama) and exposes them to MCP clients as hybrid
(BM25 + vector) search. In-memory, live-updating, offline, zero-infra.

> Runtime: **Bun** + TypeScript. Transport: **stdio** (the MCP client spawns it on demand — there
> is no long-running service to manage).

## Why stdio (and not a service)

The index is cheap to build and there's no cross-session state worth keeping warm. Letting the MCP
client spawn the process on demand is the simplest correct thing. (Contrast with `lsp-mcp`, which
keeps language servers warm and therefore runs as an HTTP service.)

## Tool surface (planned)

| Tool | Signature | Returns |
| --- | --- | --- |
| `search_knowledge` | `(query: string, k?: number, filter?: {path?, source?})` | ranked `{ path, heading, snippet, score }[]` (hybrid BM25 + vector) |
| `get_document` | `(path: string)` | full source text of an indexed file |
| `list_sources` | `()` | indexed files with chunk counts |

## Sources (pluggable adapters)

- **Markdown (`**/*.md`)** — header-based chunking; one document per section, carrying `{ path, heading }`.
- **JSONL (`**/*.jsonl`)** — one line = one document. Expects a `text` or `content` field; all other
  fields are attached as filterable metadata. Ideal for machine-generated knowledge (PR digests,
  changelog/ADR entries, Q&A) and it stays git-friendly because it's line-oriented.

New source types = new adapters feeding the same Orama index.

## Build plan

1. **Args & config** — `--globs`, `--root`, `--cache` (default `.orama-cache`, gitignored).
2. **Orama schema** — `text` (string, BM25) + `embedding` (vector) + metadata (`path`, `heading`, `source`, …).
3. **Adapters** — Markdown header splitter; JSONL line mapper.
4. **Embeddings** — local model via `fastembed-js` or `transformers.js`; **cache on disk keyed by
   `content_hash`** so a restart only re-embeds changed chunks. Pin the model + version.
5. **Live updates** — `chokidar` watcher: on add/change re-chunk that file and `insert`/`update`
   only changed chunks; on unlink `remove` its chunks.
6. **MCP server** — `@modelcontextprotocol/sdk`, stdio transport, register the three tools above.
7. **Cold-start note** — BM25 works instantly; vectors warm up after first embed (seconds for a
   docs-sized corpus). The disk cache amortizes this across restarts.

## Develop

```bash
bun install
bun run start -- --root /path/to/repo --globs "**/*.md,**/*.jsonl"   # once implemented
bun run typecheck
bun run test
```

## Non-goals

- No code or git indexing (those are exact-query jobs for ripgrep / ast-grep / LSP / git CLI).
- No network, no external database, no always-on sync.
