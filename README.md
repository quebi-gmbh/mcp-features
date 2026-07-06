# mcp-features

Reusable **[Dev Container Features](https://containers.dev/implementors/features/)** that drop **MCP servers** into any dev container, giving coding agents (Claude Code and any other MCP client) two capabilities:

| Feature | What it gives the agent | Transport | Package |
| --- | --- | --- | --- |
| **`lsp-mcp`** | Code intelligence — go-to-definition, find-references, hover/types, document & workspace symbols, diagnostics — backed by real language servers. | HTTP (warm, long-running service) | [`packages/lsp-mcp`](packages/lsp-mcp) |
| **`orama-mcp`** | Repo knowledge search — hybrid (BM25 + vector) search over every Markdown and JSONL file in the workspace, kept live as files change. | stdio (client-spawned) | [`packages/orama-mcp`](packages/orama-mcp) |

Both are **MIT licensed**, published as public OCI artifacts under `ghcr.io/quebi-gmbh/...`, and installable with one line in `devcontainer.json`.

---

## Design philosophy

These features are the "local, fresh, zero-infra" half of a code-and-knowledge retrieval system. The guiding rule: **everything is a pure function of the local clone** — no external database, no sync service, no quota. Two tiers:

**Tier 1 — live tools, no index, no embeddings.** The agent already has (or gets, via `lsp-mcp`):

- `ripgrep` — lexical code search
- `ast-grep` — structural code search
- **`lsp-mcp`** — semantic code (defs / refs / types / diagnostics)
- `git` CLI (incl. `git log --grep` / `-S` / `-G`) — history, blame, diff, commit search
- `gh` CLI — specific PR / issue lookup, on demand

**Tier 2 — the only thing that embeds, over prose only.** That's **`orama-mcp`**: Markdown docs and JSONL knowledge records, indexed in-memory and updated live.

Deliberately **out of scope**: vector-indexing code or git (the CLI/LSP tools above are exact and sufficient), and any always-running GitHub mirror (use the `gh` CLI on demand, or a periodic batch dump to committed JSONL that `orama-mcp` then indexes).

See each package README for the detailed tool surface and build plan.

---

## Usage (once published)

Add to a repo's `.devcontainer/devcontainer.json`:

```jsonc
{
  "features": {
    "ghcr.io/quebi-gmbh/mcp-features/lsp-mcp:0": {
      "languages": "typescript,python"
    },
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
    "lsp": {
      "type": "http",
      "url": "http://127.0.0.1:7337/mcp"
    }
  }
}
```

> **`claude-manager` integration.** `claude-manager` may prefer to own `.mcp.json` itself. In that case set `autoRegister: false` on both features and have the daemon write the two entries above into the project `.mcp.json` before launching the Claude session. The registration contract (stdio `command`/`args` for orama, `http` `url` for lsp) is stable — that's the only coupling between this repo and `claude-manager`.

---

## Repository layout

```
mcp-features/
├── packages/            # the MCP server implementations (Bun + TypeScript)
│   ├── lsp-mcp/         #   HTTP MCP service wrapping language servers
│   └── orama-mcp/       #   stdio MCP server over Orama
├── src/                 # the Dev Container Features (what ghcr publishes)
│   ├── lsp-mcp/         #   devcontainer-feature.json + install.sh
│   └── orama-mcp/
├── test/                # devcontainers CLI feature tests
├── turbo.json           # Turborepo pipeline
└── package.json         # Bun workspaces root
```

**Why the `packages/` ↔ `src/` split?** `packages/*` holds the actual server code (built/tested with Bun + Turbo). `src/*` holds the Dev Container Features, whose `install.sh` fetches the corresponding published server (npm or a release binary) and wires it up. The devcontainers publish/test GitHub Actions operate on `src/`.

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
```

---

## Publishing

Features are published as OCI artifacts to `ghcr.io/quebi-gmbh/mcp-features/<feature-id>` by
[`.github/workflows/release.yml`](.github/workflows/release.yml) (the official
[`devcontainers/action`](https://github.com/devcontainers/action)). Bump the `version` in each
feature's `devcontainer-feature.json` and push to `main`.

---

## Status

🚧 **Scaffold only.** This repo currently contains the shell, config, and the build plan in each
README. Nothing is implemented yet — see the `## Build plan` / TODO sections in each package and
feature README for what to do next.
