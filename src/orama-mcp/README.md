# orama-mcp (Dev Container Feature)

Installs the [`@quebi/orama-mcp`](../../packages/orama-mcp) MCP server (hybrid BM25 + vector search
over Markdown, JSONL, and PDF) and (optionally) registers it in the workspace `.mcp.json`.

By default it runs as **one shared streamable-HTTP service per container** on `127.0.0.1:7338`,
started by `postStartCommand` — the same shape as `lsp-mcp` on 7337. Every MCP client session
attaches to that one process instead of forking its own.

## Usage

```jsonc
"features": {
  "ghcr.io/quebi-gmbh/mcp-features/orama-mcp:0": {
    "globs": "**/*.md,**/*.jsonl,**/*.pdf"
  }
}
```

## Why one shared service

A stdio MCP server *is* its pipe, so it is structurally one process per client session — Claude Code
forks a fresh one each time and there is nothing to share. Measured per process on one workspace:
**557 MB RSS** (embedding model + in-memory index) and **4,294 inotify watches** for 192 files. At
12 concurrent sessions that is ~6.7 GB of twelve identical indexes and ~50k watches. Over HTTP the
index, the embedding model, and the file watcher are built once and every extra session costs only a
protocol shell. See the [package README](../../packages/orama-mcp/README.md#transports) for detail.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `version` | string | `latest` | Git ref (branch, tag, or commit) of this repo to build `packages/orama-mcp` from. `latest` resolves to `main`. |
| `transport` | string (`http` \| `stdio`) | `http` | `http` runs one shared service per container (started by `postStartCommand`). `stdio` registers the binary for the client to spawn per session instead — one full copy of the index per session. |
| `port` | string | `7338` | Port for the shared HTTP service. Ignored when `transport: stdio`. |
| `globs` | string | `**/*.md,**/*.jsonl,**/*.pdf` | Comma-separated globs to index. Dot-directories are skipped unless a glob names one — see below. |
| `ocr` | boolean | `false` | Enable OCR fallback for scanned/image-only PDFs (installs `tesseract.js`, passes `--ocr`). Born-digital PDFs never need this. |
| `autoRegister` | boolean | `true` | Merge the server into `.mcp.json`. Set `false` if `claude-manager` owns it. |

PDFs are indexed one chunk per page from the embedded text layer (via bundled pdf.js — no native
deps). With `ocr: true`, pages lacking a text layer are rasterized and OCR'd; see the
[package README](../../packages/orama-mcp/README.md#ocr-fallback---ocr-opt-in) for details.

Globs do not descend into **dot-directories**: `**/*.jsonl` matches `docs/a.jsonl` but not
`.claude/projects/a.jsonl`. Those trees are tool state, not authored knowledge, so the watcher skips
them outright rather than spending an inotify watch per directory on content it can never index (on
one checkout: 4,903 watched directories → 171, same 17 indexed files). Name one in a glob to index it
anyway — `"globs": "**/*.md,.claude/**/*.jsonl"`. See the
[package README](../../packages/orama-mcp/README.md#dot-directories-are-out-of-scope-unless-a-glob-names-one).

## Lifecycle

- **build (`install.sh`)** — installs `git`, `jq`, and Bun (system-wide, so they work regardless of
  which user the container runs as at runtime); fetches `packages/orama-mcp`'s source via a blobless
  sparse clone of this repo (it isn't published to a registry yet — see the package README's
  "native ONNX deps and bundling" note for why); runs `bun install --production && bun run build`
  in place at `/opt/orama-mcp-src/packages/orama-mcp`; writes an `orama-mcp` wrapper that runs the
  built `dist/index.js` from that location (its native embedding-model dependencies must stay
  alongside it, not be copied elsewhere), and an `orama-mcp-register` helper with this feature's
  resolved options baked in, plus an `orama-mcp-serve` wrapper that starts the shared service with
  those same options (lifecycle commands are static strings with no access to them).
- **`postCreateCommand`** — runs `orama-mcp-register` (workspace is mounted by then) to merge the
  server entry into `.mcp.json`, unless `autoRegister` is `false`.
- **`postStartCommand`** — `nohup orama-mcp-serve >/tmp/orama-mcp.log 2>&1 &`, on every container
  start. Its cwd is the workspace folder, so the server's `--root` defaults correctly. With
  `transport: stdio` the wrapper prints one line and exits 0.

> **Registration happens at CREATE time.** A container created before this feature version keeps
> whatever `.mcp.json` entry it already has (the old stdio one) until it is **rebuilt** — a restart
> alone will start the service but not re-point clients at it.

## Registration output

With `transport: http` (default):

```jsonc
{ "mcpServers": { "orama": { "type": "http", "url": "http://127.0.0.1:7338/mcp" } } }
```

With `transport: stdio`:

```jsonc
{ "mcpServers": { "orama": { "command": "orama-mcp", "args": ["--globs", "**/*.md,**/*.jsonl,**/*.pdf"] } } }
```

(With `ocr: true`, `"--ocr"` is appended to `args`.)

## When the service isn't up

There is deliberately **no fallback to spawning a private stdio copy**: a silent fallback is exactly
how you end up back at twelve processes without noticing. If nothing is listening, the session
degrades the same way `lsp-mcp` does — `ConnectionRefused`, and the session simply runs without
these tools. To diagnose:

```bash
curl -s 127.0.0.1:7338/healthz   # {"status":"ok","sessions":N,"root":"...","files":N}
cat /tmp/orama-mcp.log           # everything orama-mcp-serve wrote
pgrep -af orama-mcp
cd "$WORKSPACE" && orama-mcp-serve   # run it in the foreground to see it fail
```

- **`files: 0`** — the service is up but the index is empty: indexing/embedding may still be running
  (the first run per machine downloads the embedding model), or `globs` matches nothing — note that
  a `**` glob never reaches inside a dot-directory, so `**/*.jsonl` alone will not index
  `.claude/projects/`.
- **Connection refused** — `postStartCommand` didn't run or the process died; `/tmp/orama-mcp.log`
  has the reason.
- **"address already in use ... already serving it"** — benign. One shared server is the intended
  end state, so a second start exits 0 rather than crashing.

## Notes

- First run per project pays a one-time cost: the local embedding model is fetched from the
  Hugging Face Hub on first use per machine (cached thereafter), and each chunk's vector is computed
  once and cached on disk keyed by content hash. Lexical (BM25) search and re-runs are fast.
- Once `@quebi/orama-mcp` is published (npm or a release binary), `install.sh` should switch to that
  instead of building from a git clone — this is the pragmatic option available today, not the
  long-term one.
