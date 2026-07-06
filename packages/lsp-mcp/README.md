# @quebi/lsp-mcp

An **HTTP MCP service** that wraps real **language servers** and exposes code intelligence —
definitions, references, hover/types, symbols, diagnostics — as MCP tools.

> Runtime: **Bun** + TypeScript. Transport: **HTTP** (streamable). Starts as a long-lived service.
> Languages at launch: **TypeScript** and **Python**. (C++ is deferred — `clangd` needs a
> `compile_commands.json` compilation database, which depends on the target project's build system.)

## Why a service (and not stdio)

Language servers are **expensive to warm** (tsserver builds a `Program`; pyright indexes the venv).
If the MCP server were spawned per session (stdio), every session would re-warm the whole pool.
Running as a long-lived HTTP service keeps servers warm and shared across agent sessions.

## Where it must run

Inside the dev container, **after project dependencies are installed** (venv / interpreter for
Python, `node_modules` + `tsconfig` for TypeScript). A language server started against the wrong
environment returns useless results. The Feature handles ordering via `installsAfter` +
`postStartCommand` (see [`../../src/lsp-mcp`](../../src/lsp-mcp)).

## Tool surface (planned)

All tools are **name-first**, because LLMs think in symbol names, not `file:line:char`. The server
resolves names to positions internally via `workspace/symbol` + `documentSymbol`.

| Tool | Signature | Returns |
| --- | --- | --- |
| `find_definition` | `(name \| "path:line")` | `{ path, range, snippet }[]` |
| `find_references` | `(name)` | `{ path, range, snippet }[]` |
| `hover_type` | `(name)` | type / doc string |
| `document_symbols` | `(path)` | symbol tree for a file |
| `workspace_symbols` | `(query)` | matching symbols across the project |
| `diagnostics` | `(path)` | errors / warnings |

Mutating operations (`rename`, `code_action`) are intentionally **out of scope** — edits flow
through the agent's normal edit-and-review path, not a silent LSP apply.

## Language registry

| Language | Server | Package license |
| --- | --- | --- |
| TypeScript / JavaScript | `typescript-language-server` | MIT |
| Python | `pyright-langserver` (or `pylsp`) | MIT |

Servers are invoked as subprocesses (arm's-length), so their licenses don't affect this MIT wrapper;
the Feature only needs to ship the required redistribution notices if it bundles binaries.

## Build plan

1. **CLI** — `lsp-mcp serve --languages ts,py --port 7337 --root <cwd>`.
2. **Server pool** — spawn one server per (workspace × language), warm, LRU-evict; map extension → server.
3. **LSP client** — `vscode-jsonrpc` + `vscode-languageserver-protocol`; do `initialize` / `didOpen` handshakes.
4. **Symbol bridge** — resolve names → positions, then run the positional LSP request.
5. **MCP transport** — `@modelcontextprotocol/sdk` streamable-HTTP on `/mcp`.
6. **Health** — `GET /health` for the Feature's `postStartCommand` readiness check.

## Develop

```bash
bun install
bun run start                 # lsp-mcp serve  (once implemented)
bun run typecheck
bun run test
```

## Future

- C++ via `clangd` once the `compile_commands.json` detection/generation story is decided
  (CMake `-DCMAKE_EXPORT_COMPILE_COMMANDS=ON`, or `bear`).
- Optional SCIP/LSIF precomputed index as a cheaper alternative to warm servers at scale.
