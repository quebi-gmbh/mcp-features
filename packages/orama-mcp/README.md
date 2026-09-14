# @quebi/orama-mcp

An **MCP server** that indexes every **Markdown**, **JSONL**, and **PDF** file in the workspace
with [Orama](https://github.com/oramasearch/orama) and exposes them to MCP clients as hybrid
(BM25 + vector) search. In-memory, live-updating, offline at query time, zero external services.

> Runtime: **Bun** + TypeScript. Transports: **streamable HTTP** (one shared, long-running service
> that many client sessions attach to) and **stdio** (the binary's default; the MCP client spawns it
> on demand).

## Transports

| | stdio | streamable HTTP |
| --- | --- | --- |
| Selected by | *(default)* | `--transport http` (or `--http`) |
| Processes | one **per client session** | **one**, shared by all sessions |
| Per additional client | a full second index + embedding model | a few KB of protocol shell |
| Lifetime | dies when the client closes its pipe | outlives every client |
| Used by | standalone/CI runs, `transport: stdio` | the dev container feature's default |

A stdio MCP server *is* its pipe — the client talks over that child process's own stdin/stdout — so
it is structurally **1 process : 1 client**. Claude Code forks a fresh one per session, and there is
no sharing mechanism to bolt on: the transport itself is the constraint. Measured per process on one
workspace: **557 MB RSS** (a `@huggingface/transformers` embedding model plus an in-memory Orama
index) and **4,294 inotify watches** to serve 192 files. At 12 concurrent sessions that is ~6.7 GB
holding twelve identical copies of the same index, and ~50k watches.

Over HTTP, the `KnowledgeEngine`, the embedder, and the chokidar watcher are built **once** in
`src/index.ts` and captured by a `createMcpServer` factory. Each session still gets its own
`McpServer` — the SDK's `Server` holds a single `_transport`, so one instance cannot serve two
concurrent clients — but that instance is only a protocol shell over the one shared engine.

stdio stays the **default** so `orama-mcp --root ...` in a shell or in CI is unchanged: standalone
runs have no shared server to attach to.

### Running as a service

```bash
orama-mcp --transport http --host 127.0.0.1 --port 7338 --root /path/to/repo
curl -s 127.0.0.1:7338/healthz    # {"status":"ok","sessions":0,"root":"...","files":192}
```

`GET /healthz` is the readiness and debugging endpoint: it reports the live session count, the
indexed root, and how many files are currently in the index (`files: 0` means indexing hasn't
finished — or found nothing).

### Notes on running longer than your clients

Four things follow from the process outliving the sessions it serves:

- **Sessions are capped (256) and evicted LRU.** A client is *supposed* to `DELETE` its session on
  shutdown; the MCP client SDK's `close()` does not, and a killed process cannot. Eviction is by
  least-recent **activity**, not on an idle timer: an agent session can idle for hours and still be
  live, and reaping it would turn a harmless leak into a broken tool call.
- **DNS rebinding protection is on.** Binding to loopback does *not* stop a browser page on the same
  machine being aimed at `127.0.0.1`; pinning the `Host` header does. The allowlist is derived from
  the port actually **bound** (with `--port 0` pinning the literal `0` would reject everything) and
  covers `host:port`, `127.0.0.1:port`, `localhost:port`, and `[::1]:port`.
- **Session routing follows the MCP streamable-HTTP spec.** An `initialize` POST with no
  `Mcp-Session-Id` mints a session; later requests quote it; an unknown id gets **404** so a
  spec-compliant client re-initializes; a non-`initialize` POST with no id gets **400**. An empty or
  repeated `Mcp-Session-Id` header is treated as *absent*, not as an unknown session.
- **Losing the start race is success.** `EADDRINUSE` exits **0** with "another orama-mcp is already
  serving it" — one shared server is the intended end state, so a racing second start is benign.

Request bodies are read manually and passed to the SDK as `parsedBody`, capped at 4 MB rather than
buffered unboundedly.

## Tool surface

| Tool | Signature | Returns |
| --- | --- | --- |
| `search_knowledge` | `(query, k? = 10, path?, source?)` | ranked text hits (`path`, `heading`, snippet, score) via hybrid BM25 + vector search; `source` ∈ `markdown` \| `jsonl` \| `pdf` |
| `get_document` | `(path)` | full source text of an indexed file (for PDFs: the extracted text) |
| `list_sources` | `()` | indexed files with chunk counts |

## Sources (pluggable adapters)

- **Markdown (`**/*.md`)** — header-based chunking; one chunk per `#`-`######` section, carrying `{ path, heading }`. Content before the first header becomes a headerless chunk. Header-only sections (no body text) are dropped.
- **JSONL (`**/*.jsonl`)** — one line = one chunk. Expects a `text` or `content` string field; malformed or fieldless lines are skipped.
- **PDF (`**/*.pdf`)** — one chunk per page (heading `page N`), text pulled from the embedded text layer via [`unpdf`](https://github.com/unjs/unpdf) (bundled pdf.js, no native deps). Empty pages are dropped. Extracted page text is cached on disk under `<cache>/pdf-text/<sha256>.json` keyed by the file's **byte** hash, so a PDF is only re-parsed when its bytes change. Because parsing is heavier than reading text files, the watcher caps concurrent file indexing (4 at a time).

New source types = new adapter modules under `src/adapters/` feeding the same `KnowledgeEngine`.

### OCR fallback (`--ocr`, opt-in)

Born-digital PDFs (a real text layer — most papers) need no OCR; the above covers them. Scanned /
image-only PDFs have no text layer, so pages come back empty. With `--ocr`, those pages (and only
those — pages with usable text are left untouched) are rasterized and run through OCR.

OCR uses [`tesseract.js`](https://github.com/naptha/tesseract.js), loaded via a **lazy, computed
`import`** so it is *not* a dependency of this package and never enters the default bundle/image. To
use it: `bun add tesseract.js`, then pass `--ocr`. If `--ocr` is set but the package isn't installed,
the server logs a warning and falls back to text-layer-only extraction. The OCR flag is part of the
cache key (`<sha256>.ocr.json`), so toggling it never serves stale text-only output.

## Embeddings

Vectors come from a local model (`Xenova/all-MiniLM-L6-v2`, 384-dim, int8-quantized) run in-process
via [`@huggingface/transformers`](https://github.com/huggingface/transformers.js) — no API key, no
external service. Each chunk's embedding is cached on disk under `<cache>/embeddings/<sha256>.json`
keyed by the chunk's own content hash, so a restart only re-embeds text that actually changed.

**Cold start**: the model itself is fetched from the Hugging Face Hub on first use per machine (and
cached under `<cache>/models` thereafter) — the one point where this isn't fully offline. After
that, and across restarts, only genuinely new/changed chunks pay the embedding cost.

> **Why `<cache>/models` and not the library default:** transformers.js caches downloaded models
> under its own package directory (`<pkg>/.cache`) and honors no environment override. In the
> installed feature that directory is root-owned while the server runs as an unprivileged user, so
> the download would fail with `EACCES` and the index would silently stay empty. We redirect it via
> `env.cacheDir` (the only supported override) into the workspace-local, writable, gitignored cache
> dir — see `src/embeddings.ts`.

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
`unlink` it removes that file's chunks.

Because chokidar takes one inotify watch per directory it descends into, the `--globs` filter alone
saves nothing on watch count — it only stops a matched-nothing file from being *indexed*. Directories
that cannot hold indexable content are therefore pruned outright, by name, at any depth:
`node_modules`, `.git`, `.pnpm-store`, `dist`, `build`, `.wrangler`, `.react-router` and
`.playwright-mcp`, plus the cache directory itself. Gitignored-but-authored trees (`.claude/`, for
one) are deliberately still watched.

## Develop

```bash
bun install
bun run build
bun run start -- --root /path/to/repo --globs "**/*.md,**/*.jsonl,**/*.pdf"
bun run start -- --http --root /path/to/repo          # the shared-service mode
bun run typecheck
bun run test
```

CLI flags:

| Flag | Default | Meaning |
| --- | --- | --- |
| `--root` | cwd | Directory to index. |
| `--globs` | `**/*.md,**/*.jsonl,**/*.pdf` | Comma-separated globs to index. |
| `--cache` | `.orama-cache` under root | Embedding/PDF-text cache — gitignore this. |
| `--ocr` | off | OCR fallback for scanned PDFs; requires `tesseract.js`, see above. |
| `--transport` | `stdio` | `stdio` or `http`. `--http` is shorthand for `--transport http`. |
| `--host` | `127.0.0.1` | HTTP only. |
| `--port` | `7338` | HTTP only; `0` asks the OS for an ephemeral port. |
| `--path` | `/mcp` | HTTP only; the path the MCP endpoint is served on. |

An unknown `--transport` or an out-of-range `--port` is a hard error, not a silent fallback: in HTTP
mode a typo would otherwise leave the port unbound and every client would degrade to
`ConnectionRefused`.

## Non-goals

- No code or git indexing (those are exact-query jobs for ripgrep / ast-grep / LSP / git CLI).
- No network at query time, no external database, no always-on sync (only the one-time model
  download noted above).
- No authentication on the HTTP transport. It binds to loopback and pins `Host`; it is a
  container-local service, not a multi-tenant one.
