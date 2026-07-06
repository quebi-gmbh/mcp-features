# orama-mcp (Dev Container Feature)

Installs the [`@quebi/orama-mcp`](../../packages/orama-mcp) stdio MCP server and (optionally)
registers it in the workspace `.mcp.json`.

## Usage

```jsonc
"features": {
  "ghcr.io/quebi-gmbh/mcp-features/orama-mcp:0": {
    "globs": "**/*.md,**/*.jsonl"
  }
}
```

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `version` | string | `latest` | Version of `@quebi/orama-mcp` to install. |
| `globs` | string | `**/*.md,**/*.jsonl` | Comma-separated globs to index. |
| `autoRegister` | boolean | `true` | Merge the server into `.mcp.json`. Set `false` if `claude-manager` owns it. |

## Lifecycle

- **build (`install.sh`)** — installs Bun + the `orama-mcp` binary + a `orama-mcp-register` helper.
- **`postCreateCommand`** — runs `orama-mcp-register` (workspace is mounted by then) to merge the
  stdio entry into `.mcp.json`, unless `autoRegister` is `false`.

No service to start — the MCP client spawns `orama-mcp` on demand (stdio).

## Registration output

```jsonc
{ "mcpServers": { "orama": { "command": "orama-mcp", "args": ["--globs", "**/*.md,**/*.jsonl"] } } }
```

🚧 `install.sh` is a scaffold — see its `TODO` markers.
