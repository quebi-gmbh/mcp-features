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
| `autoIndex` | boolean | `false` | Auto-index new projects on first MCP session connection (`config set auto_index`). |
| `autoRegister` | boolean | `true` | Merge the server into `.mcp.json`. Set `false` if `claude-manager` owns it. |

## Lifecycle

- **build (`install.sh`)** — runs the upstream installer (`--dir=/usr/local/bin --skip-config`),
  which detects OS/arch, downloads the matching release archive, and verifies its SHA-256 checksum
  before installing. `--skip-config` opts out of the binary's own multi-agent auto-configuration
  (which would run against the build-time filesystem, before any workspace or agent config exists,
  and doesn't fit this repo's registration convention) — we register it ourselves instead. Also
  sets the global `auto_index` config and writes a `codebase-memory-mcp-register` helper with this
  feature's resolved options baked in.
- **`postCreateCommand`** — runs `codebase-memory-mcp-register` to merge the stdio entry into
  `.mcp.json`, unless `autoRegister` is `false`.

There's no `postStartCommand`: like `orama-mcp`, this is a **stdio** server — the MCP client spawns
it on demand per session rather than it running as a standing service. Its background file watcher
(`auto_watch`, default enabled) lives only as long as that spawned process does.

## Registration output

```jsonc
{ "mcpServers": { "codebase-memory": { "command": "codebase-memory-mcp", "args": [] } } }
```

## Notes

- First use per project requires indexing: say "index this project" (or enable `autoIndex`). Indexing
  is fast (an average repo in milliseconds; the Linux kernel in ~3 minutes) and runs in-memory, with
  results persisted to SQLite under `~/.cache/codebase-memory-mcp/`.
- Read-only over your source: it only writes to its own SQLite cache and to Architecture Decision
  Records (`manage_adr`) it manages itself. It never edits your code — that's what `lsp-mcp` is for.
- One of its 14 tools, `semantic_query`, does vector search over the indexed graph using a bundled
  embedding model. This is a narrow, optional part of its surface — most of its value (call graph,
  Cypher queries, dead-code detection, HTTP linking) is exact structural analysis, not embeddings.
- Full type-accurate ("Hybrid LSP") call-graph resolution is available for 9 languages (Python,
  TypeScript/JS/JSX/TSX, PHP, C#, Go, C/C++, Java, Kotlin, Rust); the other ~149 of its 158 supported
  languages get tree-sitter-only structural extraction (naming/calls, no type resolution).
