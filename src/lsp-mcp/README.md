# lsp-mcp (Dev Container Feature)

Installs [Serena](https://github.com/oraios/serena) (MIT) and runs it as a long-lived HTTP MCP
service, giving MCP clients such as Claude Code semantic code intelligence — find symbol, find
references, hover/types, document & workspace symbols, diagnostics, and LSP-backed rename.

This feature is a thin wrapper: Serena does the actual LSP integration work (spawning and talking
to `typescript-language-server`, `pyright`, and 40+ other language servers, which it manages and
auto-downloads itself). The feature's job is installing it, starting it warm at container boot,
and registering it with MCP clients — the same lifecycle contract as before, just backed by a
different implementation.

## Usage

```jsonc
"features": {
  "ghcr.io/quebi-gmbh/mcp-features/lsp-mcp:0": {}
}
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `version` | string | `latest` | Version of the `serena-agent` PyPI package to install. |
| `pythonVersion` | string | `3.13` | Python version `uv` provisions to run Serena. |
| `port` | string | `7337` | Port for the HTTP MCP service. |
| `enableWebDashboard` | boolean | `false` | Enable Serena's web dashboard. Off by default in a headless container. |
| `autoRegister` | boolean | `true` | Merge the server into `.mcp.json`. Set `false` if `claude-manager` owns it. |

## Lifecycle

- **build (`install.sh`)** — installs `uv`, then `serena-agent` via `uv tool install`, both to
  system-wide paths (`/usr/local/bin`, `/usr/local/share/uv-tools`) so they work regardless of
  which user the container runs as at runtime. Writes two wrapper scripts with this feature's
  resolved options baked in (`postStartCommand`/`postCreateCommand` are static strings and can't
  read Feature options themselves):
  - `lsp-mcp-serve` — starts Serena in `streamable-http` transport mode.
  - `lsp-mcp-register` — merges the HTTP entry into `.mcp.json`.
- **`postStartCommand`** — runs `lsp-mcp-serve` (backgrounded) each time the container starts.
  Serena activates the project via `--project-from-cwd` (the dev container spec runs lifecycle
  commands with cwd = the workspace folder), auto-generating its project config on first run and
  keeping the language servers it spawns warm across agent sessions.
- **`postCreateCommand`** — runs `lsp-mcp-register` to merge the HTTP entry into `.mcp.json`,
  unless `autoRegister` is `false`.

## Registration output

```jsonc
{ "mcpServers": { "lsp": { "type": "http", "url": "http://127.0.0.1:7337/mcp" } } }
```

## Notes

- Must run where project deps are installed (in-container, post-install) — the underlying language
  servers need the project's own `node_modules`/`tsconfig.json` or Python venv to resolve types
  correctly, same as running an IDE locally.
- For languages beyond TypeScript/Python, some of Serena's language servers need extra tooling
  preinstalled (e.g. Go needs `gopls`, Rust needs `rustup`) — see
  [Serena's language support docs](https://oraios.github.io/serena/01-about/020_programming-languages.html)
  and add the relevant dev container feature(s) as needed. TypeScript and Python need nothing extra.
- Serena's `rename` only renames symbols (not files/directories — that requires its paid JetBrains
  backend). It applies edits to disk directly, which is deliberate: renaming through the language
  server is far more reliable and token-cheap than an agent locating and rewriting every call site
  by hand.
