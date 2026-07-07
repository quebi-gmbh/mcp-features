# mcp-features

Reusable **[Dev Container Features](https://containers.dev/implementors/features/)** that drop **MCP servers** into any dev container, giving coding agents (Claude Code and any other MCP client) three capabilities:

| Feature | What it gives the agent | Transport | Implementation |
| --- | --- | --- | --- |
| **`lsp-mcp`** | Code intelligence — find symbol, find-references, hover/types, document & workspace symbols, diagnostics, LSP-backed rename — backed by real language servers. | HTTP (warm, long-running service) | wraps [`oraios/serena`](https://github.com/oraios/serena) (MIT) |
| **`codebase-memory-mcp`** | Repo-scale structure — architecture overview, call-graph traversal, dead-code detection, HTTP/gRPC cross-service linking, git-diff blast-radius, Cypher-like graph queries. | stdio (client-spawned) | wraps [`DeusData/codebase-memory-mcp`](https://github.com/DeusData/codebase-memory-mcp) (MIT) |
| **`orama-mcp`** | Repo knowledge search — hybrid (BM25 + vector) search over every Markdown and JSONL file in the workspace, kept live as files change. | stdio (client-spawned) | [`packages/orama-mcp`](packages/orama-mcp) |

All three are **MIT licensed**, published as public OCI artifacts under `ghcr.io/quebi-gmbh/...`, and installable with one line in `devcontainer.json`.

---

## Design philosophy

These features are the "local, fresh, zero-infra" half of a code-and-knowledge retrieval system. The guiding rule: **everything is a pure function of the local clone** — no external database, no sync service, no quota. Three tiers, each answering a different class of question:

**Tier 1 — live tools, no index, no embeddings.** Exact, symbol/text-level answers. The agent
already has (or gets, via `lsp-mcp`):

- `ripgrep` — lexical code search
- `ast-grep` — structural code search
- **`lsp-mcp`** — semantic code, single-symbol precision (defs / refs / types / diagnostics / rename)
- `git` CLI (incl. `git log --grep` / `-S` / `-G`) — history, blame, diff, commit search
- `gh` CLI — specific PR / issue lookup, on demand

**Tier 1.5 — a persistent structural graph, over code only.** That's **`codebase-memory-mcp`**:
repo-scale questions Tier 1 can't answer in one call — architecture overview, call-graph traversal,
dead-code detection, cross-service HTTP/gRPC linking, git-diff blast-radius. Mostly exact structural
analysis (tree-sitter + Cypher-like queries), not semantic search — see the note below.

**Tier 2 — the only tier that primarily embeds, over prose.** That's **`orama-mcp`**: Markdown docs
and JSONL knowledge records, indexed in-memory and updated live.

> **On "no vector-indexing code."** We previously ruled that out entirely, reasoning the CLI/LSP
> tools above were exact and sufficient — and for single-symbol precision, they still are. But
> repo-scale structural questions (architecture, dead code, blast-radius) have no equivalent among
> them, which is what justified adding `codebase-memory-mcp`. Its `semantic_query` tool does use a
> bundled embedding model, but it's one of 14 tools and not why we added it — the rest of its
> surface is exact graph/Cypher analysis, not vector search.

Deliberately **out of scope**: any always-running GitHub mirror (use the `gh` CLI on demand, or a
periodic batch dump to committed JSONL that `orama-mcp` then indexes).

See each package README for the detailed tool surface and build plan.

---

## Usage (once published)

Add to a repo's `.devcontainer/devcontainer.json`:

```jsonc
{
  "features": {
    "ghcr.io/quebi-gmbh/mcp-features/lsp-mcp:0": {},
    "ghcr.io/quebi-gmbh/mcp-features/codebase-memory-mcp:0": {},
    "ghcr.io/quebi-gmbh/mcp-features/orama-mcp:0": {
      "globs": "**/*.md,**/*.jsonl"
    }
  }
}
```

Rebuild the container and the tools are installed, started, and (optionally) registered with any MCP client in the workspace.

---

## MCP registration contract

Each feature can register itself by writing/merging a `.mcp.json` at the workspace root (the format Claude Code auto-discovers). This is controlled by the `autoRegister` option (default `true`).

```jsonc
// .mcp.json (what the features produce)
{
  "mcpServers": {
    "orama": {
      "command": "orama-mcp",
      "args": ["--globs", "**/*.md,**/*.jsonl"]
    },
    "codebase-memory": {
      "command": "codebase-memory-mcp",
      "args": []
    },
    "lsp": {
      "type": "http",
      "url": "http://127.0.0.1:7337/mcp"
    }
  }
}
```

> **`claude-manager` integration.** `claude-manager` may prefer to own `.mcp.json` itself. In that case set `autoRegister: false` on all three features and have the daemon write the entries above into the project `.mcp.json` before launching the Claude session. The registration contract (stdio `command`/`args` for orama and codebase-memory, `http` `url` for lsp) is stable — that's the only coupling between this repo and `claude-manager`.

---

## Repository layout

```
mcp-features/
├── packages/                 # the MCP server implementations we own (Bun + TypeScript)
│   └── orama-mcp/            #   stdio MCP server over Orama
├── src/                      # the Dev Container Features (what ghcr publishes)
│   ├── lsp-mcp/              #   devcontainer-feature.json + install.sh (wraps Serena)
│   ├── codebase-memory-mcp/  #   devcontainer-feature.json + install.sh (wraps codebase-memory-mcp)
│   └── orama-mcp/            #   devcontainer-feature.json + install.sh (installs packages/orama-mcp)
├── test/                     # devcontainers CLI feature tests
├── turbo.json                # Turborepo pipeline
└── package.json              # Bun workspaces root
```

**Why the `packages/` ↔ `src/` split?** `packages/*` holds MCP server code we own (built/tested with
Bun + Turbo). `src/*` holds the Dev Container Features, whose `install.sh` wires up the corresponding
server. `lsp-mcp` and `codebase-memory-mcp` are both exceptions: rather than maintaining from-scratch
implementations, their `install.sh` scripts install and wrap existing, actively maintained MCP
servers ([Serena](https://github.com/oraios/serena),
[codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)) — so there's no
`packages/lsp-mcp` or `packages/codebase-memory-mcp`. The devcontainers publish/test GitHub Actions
operate on `src/` either way.

---

## Development

Requires [Bun](https://bun.sh) ≥ 1.2.

```bash
bun install
bun run build       # turbo: build all packages
bun run typecheck
bun run test
```

Test a feature locally with the devcontainers CLI:

```bash
npm i -g @devcontainers/cli
devcontainer features test --features orama-mcp --base-image mcr.microsoft.com/devcontainers/base:ubuntu .
devcontainer features test --features codebase-memory-mcp --base-image mcr.microsoft.com/devcontainers/base:ubuntu .
```

---

## Publishing

Features are published as OCI artifacts to `ghcr.io/quebi-gmbh/mcp-features/<feature-id>` by
[`.github/workflows/release.yml`](.github/workflows/release.yml) (the official
[`devcontainers/action`](https://github.com/devcontainers/action)). Bump the `version` in each
feature's `devcontainer-feature.json` and push to `main`.

> **This is easy to forget, and the publish step won't tell you.** It's idempotent and
> version-gated: if `version` is unchanged, it silently skips that feature (logging
> `Version X already exists, skipping` — not a failure, so CI stays green) and the registry keeps
> serving whatever was last published under that version. Any PR that changes a feature's behavior
> — `install.sh`, or the package it installs — must also bump that feature's `version`, or the
> change never reaches `ghcr.io` despite tests passing.

---

## Status

- **`lsp-mcp`** — implemented: `src/lsp-mcp` installs and wraps Serena as a warm HTTP MCP service.
- **`codebase-memory-mcp`** — implemented: `src/codebase-memory-mcp` installs and wraps
  codebase-memory-mcp as a stdio MCP server. Live-verified end-to-end (install, `tools/list`,
  `index_repository`, `search_graph`, `trace_path`, and a Cypher `query_graph` dead-code check all
  confirmed against a real fixture project), same as `lsp-mcp`.
- **`orama-mcp`** — 🚧 scaffold only; see its package/feature README `## Build plan` / TODO sections
  for what to do next.
