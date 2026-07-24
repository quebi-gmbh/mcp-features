# codebase-memory-mcp (Dev Container Feature)

Installs [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) (MIT), a single
static binary that parses the workspace with tree-sitter into a persistent SQLite knowledge graph
and exposes it as a **stdio MCP server**: architecture overview, call-graph traversal, dead-code
detection, HTTP/gRPC/pub-sub cross-service linking, git-diff blast-radius analysis, and
Cypher-like graph queries.

## Why this is a separate feature from `lsp-mcp`

`lsp-mcp` (Serena) answers precise, single-symbol questions using the real language server — exact
by construction, and the only one of the two that can safely rename/edit code. This feature answers
a different class of question: **repo-scale structural questions** ("what's the architecture here?",
"what's dead code?", "what would this git diff break?", "how do these services call each other over
HTTP?") that neither `lsp-mcp` nor Tier 1 tools (`ripgrep`, `ast-grep`, `git`, `gh`) cover. They're
complementary, not redundant — see the root README's design philosophy section.

## Usage

```jsonc
"features": {
  "ghcr.io/quebi-gmbh/mcp-features/codebase-memory-mcp:0": {}
}
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `version` | string | `latest` | Release tag to install (e.g. `v0.8.0`), or `latest`. |
| `ui` | boolean | `false` | Install the UI variant (adds an optional 3D graph-visualization web UI at `localhost:9749`). |
| `autoIndex` | boolean | `false` | The binary's own lazy auto-indexing of new projects on first MCP session connection (`config set auto_index`). Independent of `indexOnStart`. |
| `indexOnStart` | boolean | `true` | Eagerly index the workspace project at container start (`postStartCommand`) so the MCP tools work out of the box on the first call. Idempotent, `fast` mode (no persistence artifact), runs in the background. |
| `autoRegister` | boolean | `true` | Merge the server into `.mcp.json`. Set `false` if `claude-manager` owns it. |

## Lifecycle

- **build (`install.sh`)** — downloads the matching release archive (`linux-<arch>-portable`,
  UI variant if `ui` is set) straight from GitHub Releases, verifies its SHA-256 against the
  release's `checksums.txt`, and installs the binary to `/usr/local/bin` itself. It deliberately
  does **not** run upstream's `install.sh` (whose logic tracks upstream `main` and can change
  between builds — pinning `version` here pins everything) and never invokes the binary's own
  `install` subcommand, so its multi-agent auto-configuration (which would run against the
  build-time filesystem, before any workspace or agent config exists, and doesn't fit this repo's
  registration convention) never runs — we register it ourselves instead. Also sets the global
  `auto_index` config and writes a `codebase-memory-mcp-register` helper with this feature's
  resolved options baked in.
- **`postCreateCommand`** — runs `codebase-memory-mcp-register` to merge the stdio entry into
  `.mcp.json`, unless `autoRegister` is `false`.
- **`postStartCommand`** — runs `codebase-memory-mcp-index`, which makes an index **exist** for the
  workspace so the MCP tools work out of the box (unless `indexOnStart` is `false`). Without this a
  fresh container has an empty store, so the first `search_graph`/`search_code`/`trace_path` call
  returns *"No projects indexed"*, the agent falls back to `grep`, and never tries the tools again.
  The helper is **idempotent** (skips if the workspace project is already in the store), indexes in
  **`fast`** mode (no similarity/semantic edges and **no** `.codebase-memory/graph.db.zst` persistence
  artifact), and runs **in the background** so it never blocks container start or the first tool call.

Unlike the HTTP `lsp-mcp` service, the `postStartCommand` here does **not** start a standing daemon:
like `orama-mcp`, this is a **stdio** server — the MCP client spawns it on demand per session rather
than it running as a service. Its background file watcher (`auto_watch`, default enabled) lives only
as long as that spawned process does. The `postStartCommand` only ensures the shared index exists;
it exits as soon as indexing is dispatched.

## Registration output

```jsonc
{ "mcpServers": { "codebase-memory": { "command": "codebase-memory-mcp", "args": [] } } }
```

## Notes

- The workspace is indexed for you at container start (`indexOnStart`, default on), so the tools work
  on the first call — no "index this project" step. For extra projects opened later you can still say
  "index this project" (or enable `autoIndex` for lazy indexing on first session connection). Indexing
  is fast (an average repo in milliseconds; the Linux kernel in ~3 minutes) and runs in-memory, with
  results kept in the shared store under `~/.cache/codebase-memory-mcp/`. `fast` mode writes no
  in-workspace `.codebase-memory/graph.db.zst` persistence artifact.
- Read-only over your source: it only writes to its own SQLite cache and to Architecture Decision
  Records (`manage_adr`) it manages itself. It never edits your code — that's what `lsp-mcp` is for.
- One of its 14 tools, `semantic_query`, does vector search over the indexed graph using a bundled
  embedding model. This is a narrow, optional part of its surface — most of its value (call graph,
  Cypher queries, dead-code detection, HTTP linking) is exact structural analysis, not embeddings.
- Full type-accurate ("Hybrid LSP") call-graph resolution is available for 9 languages (Python,
  TypeScript/JS/JSX/TSX, PHP, C#, Go, C/C++, Java, Kotlin, Rust); the other ~149 of its 158 supported
  languages get tree-sitter-only structural extraction (naming/calls, no type resolution).
