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
| `version` | string | `latest` | Git ref (branch, tag, or commit) of this repo to build `packages/orama-mcp` from. `latest` resolves to `main`. |
| `globs` | string | `**/*.md,**/*.jsonl` | Comma-separated globs to index. |
| `autoRegister` | boolean | `true` | Merge the server into `.mcp.json`. Set `false` if `claude-manager` owns it. |

## Lifecycle

- **build (`install.sh`)** — installs `git`, `jq`, and Bun (system-wide, so they work regardless of
  which user the container runs as at runtime); fetches `packages/orama-mcp`'s source via a blobless
  sparse clone of this repo (it isn't published to a registry yet — see the package README's
  "native ONNX deps and bundling" note for why); runs `bun install --production && bun run build`
  in place at `/opt/orama-mcp-src/packages/orama-mcp`; writes an `orama-mcp` wrapper that runs the
  built `dist/index.js` from that location (its native embedding-model dependencies must stay
  alongside it, not be copied elsewhere), and an `orama-mcp-register` helper with this feature's
  resolved options baked in.
- **`postCreateCommand`** — runs `orama-mcp-register` (workspace is mounted by then) to merge the
  stdio entry into `.mcp.json`, unless `autoRegister` is `false`.

No service to start — the MCP client spawns `orama-mcp` on demand (stdio).

## Registration output

```jsonc
{ "mcpServers": { "orama": { "command": "orama-mcp", "args": ["--globs", "**/*.md,**/*.jsonl"] } } }
```

## Notes

- First run per project pays a one-time cost: the local embedding model is fetched from the
  Hugging Face Hub on first use per machine (cached thereafter), and each chunk's vector is computed
  once and cached on disk keyed by content hash. Lexical (BM25) search and re-runs are fast.
- Once `@quebi/orama-mcp` is published (npm or a release binary), `install.sh` should switch to that
  instead of building from a git clone — this is the pragmatic option available today, not the
  long-term one.
