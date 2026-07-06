#!/usr/bin/env bun
/**
 * lsp-mcp — HTTP MCP service exposing LSP-backed code intelligence.
 *
 * ┌─ SCAFFOLD ────────────────────────────────────────────────────────────────┐
 * │ This is an intentionally minimal entrypoint. See ./README.md "Build plan". │
 * └────────────────────────────────────────────────────────────────────────────┘
 *
 * Runs as a LONG-LIVED HTTP service (unlike orama-mcp's stdio) so language
 * servers stay warm across agent sessions.
 *
 * Intended shape:
 *
 *   1. Server pool: spawn one language server per (workspace x language), keep
 *      warm, LRU-evict. Extension -> server map:
 *        .ts/.tsx/.js/.jsx -> typescript-language-server --stdio
 *        .py               -> pyright-langserver --stdio   (or pylsp)
 *      Run it WHERE the toolchain is (in-container, after deps are installed) or
 *      results are garbage.
 *   2. LSP client: talk to each server over stdio JSON-RPC via `vscode-jsonrpc`
 *      + `vscode-languageserver-protocol`. Do LSP initialize/didOpen handshakes.
 *   3. Symbol bridge: LSP is position-based (file:line:char); LLMs think in
 *      NAMES. Resolve names via workspace/symbol + documentSymbol, then run the
 *      positional request. Expose NAME-first tools:
 *        - find_definition(name | path:line)
 *        - find_references(name)
 *        - hover_type(name)
 *        - document_symbols(path)
 *        - workspace_symbols(query)
 *        - diagnostics(path)
 *      Each returns { path, range, snippet }. (Mutating ops like rename are
 *      intentionally out of scope — edits go through the agent's normal flow.)
 *   4. MCP over HTTP: `@modelcontextprotocol/sdk` streamable-HTTP transport on
 *      --port (default 7337), path /mcp.
 *
 * CLI:  lsp-mcp serve --languages typescript,python --port 7337 --root <cwd>
 */

const cmd = process.argv[2];

async function main(): Promise<void> {
  if (cmd !== "serve") {
    process.stderr.write("usage: lsp-mcp serve [--languages ...] [--port N] [--root DIR]\n");
    process.exit(2);
  }
  // TODO: replace this stub with the warm-pool HTTP MCP service described above.
  process.stderr.write(
    "lsp-mcp: scaffold only — not implemented yet. See packages/lsp-mcp/README.md\n",
  );
  process.exit(1);
}

void main();
