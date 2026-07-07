# @quebi/orama-mcp

A **stdio MCP server** that indexes every **Markdown** and **JSONL** file in the workspace with
[Orama](https://github.com/oramasearch/orama) and exposes them to MCP clients as hybrid
(BM25 + vector) search. In-memory, live-updating, offline at query time, zero external services.

> Runtime: **Bun** + TypeScript. Transport: **stdio** (the MCP client spawns it on demand — there
> is no long-running service to manage).

## Why stdio (and not a service)

The index is cheap to build and there's no cross-session state worth keeping warm. Letting the MCP
client spawn the process on demand is the simplest correct thing. (Contrast with `lsp-mcp`, which
keeps language servers warm and therefore runs as an HTTP service.)

## Tool surface

| Tool | Signature | Returns |
| --- | --- | --- |
| `search_knowledge` | `(query, k? = 10, path?, source?)` | ranked text hits (`path`, `heading`, snippet, score) via hybrid BM25 + vector search |
| `get_document` | `(path)` | full source text of an indexed file |
| `list_sources` | `()` | indexed files with chunk counts |

## Sources (pluggable adapters)

- **Markdown (`**/*.md`)** — header-based chunking; one chunk per `#`-`######` section, carrying `{ path, heading }`. Content before the first header becomes a headerless chunk. Header-only sections (no body text) are dropped.
- **JSONL (`**/*.jsonl`)** — one line = one chunk. Expects a `text` or `content` string field; malformed or fieldless lines are skipped.

New source types = new adapter modules under `src/adapters/` feeding the same `KnowledgeEngine`.

## Embeddings

Vectors come from a local model (`Xenova/all-MiniLM-L6-v2`, 384-dim, int8-quantized) run in-process
via [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) — no API key, no
external service. Each chunk's embedding is cached on disk under `<cache>/embeddings/<sha256>.json`
keyed by the chunk's own content hash, so a restart only re-embeds text that actually changed.

**Cold start**: the model itself is fetched from the Hugging Face Hub on first use per machine (and
cached by the library thereafter) — the one point where this isn't fully offline. After that, and
across restarts, only genuinely new/changed chunks pay the embedding cost.

### A build note: native ONNX deps and bundling

`onnxruntime-node` ships a platform-specific native `.node` binary and is resolved via a relative
path from its own package directory at runtime. Bundling it (`bun build` inlining it into
`dist/index.js`) breaks that relative path. So `onnxruntime-node`, `onnxruntime-common`, `sharp`,
and `@huggingface/transformers` are all marked `--external` in the `build` script, and `dist/index.js`
must keep running from inside this package directory (with its `node_modules` alongside it as a
sibling) — not copied elsewhere on its own. `onnxruntime-common` is also listed as a **direct**
dependency here (not just transitively via `onnxruntime-node`) because Bun's install resolution
doesn't reliably hoist it otherwise.

## Live updates

A [chokidar](https://github.com/paulmillr/chokidar) watcher (chokidar itself dropped built-in glob
support in v4+, so `--globs` matching is done here via `picomatch`) watches the whole workspace root
and on `add`/`change` re-chunks and re-embeds just that file (replacing its prior chunks); on
`unlink` it removes that file's chunks. `node_modules`, `.git`, and the cache directory itself are
always excluded.

## Develop

```bash
bun install
bun run build
bun run start -- --root /path/to/repo --globs "**/*.md,**/*.jsonl"
bun run typecheck
bun run test
```

CLI flags: `--root` (default cwd), `--globs` (default `**/*.md,**/*.jsonl`), `--cache` (default
`.orama-cache` under root — gitignore this).

## Non-goals

- No code or git indexing (those are exact-query jobs for ripgrep / ast-grep / LSP / git CLI).
- No network at query time, no external database, no always-on sync (only the one-time model
  download noted above).
