# lsp-mcp (Dev Container Feature)

Installs language servers + the [`@quebi/lsp-mcp`](../../packages/lsp-mcp) HTTP MCP service, starts
it warm at container boot, and (optionally) registers it in the workspace `.mcp.json`.

## Usage

```jsonc
"features": {
  "ghcr.io/quebi-gmbh/mcp-features/lsp-mcp:0": {
    "languages": "typescript,python"
  }
}
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `version` | string | `latest` | Version of `@quebi/lsp-mcp` to install. |
| `languages` | string | `typescript,python` | Languages to enable. Supported: `typescript`, `python`. |
| `port` | string | `7337` | Port for the HTTP MCP service. |
| `autoRegister` | boolean | `true` | Merge the server into `.mcp.json`. Set `false` if `claude-manager` owns it. |

## Lifecycle

- **build (`install.sh`)** — installs Bun, the requested language servers, the `lsp-mcp` binary, and
  a `lsp-mcp-register` helper. Runs **after** the Node/Python features (`installsAfter`) so the
  toolchains exist.
- **`postStartCommand`** — launches `lsp-mcp serve` (backgrounded) each time the container starts,
  keeping language servers **warm across sessions**.
- **`postCreateCommand`** — runs `lsp-mcp-register` to merge the HTTP entry into `.mcp.json`, unless
  `autoRegister` is `false`.

## Registration output

```jsonc
{ "mcpServers": { "lsp": { "type": "http", "url": "http://127.0.0.1:7337/mcp" } } }
```

## Notes

- Must run where project deps are installed (in-container, post-install) or navigation is wrong.
- C++ is intentionally not supported yet — `clangd` needs a `compile_commands.json`.

🚧 `install.sh` is a scaffold — see its `TODO` markers.
