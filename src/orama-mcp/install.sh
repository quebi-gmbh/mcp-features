#!/usr/bin/env bash
# Dev Container Feature installer for orama-mcp.
# Runs at image BUILD time. Options arrive as UPPERCASED env vars.
set -euo pipefail

VERSION="${VERSION:-latest}"
GLOBS="${GLOBS:-**/*.md,**/*.jsonl}"
AUTOREGISTER="${AUTOREGISTER:-true}"

echo "[orama-mcp] installing (version=${VERSION}, autoRegister=${AUTOREGISTER})"

# 1. Ensure Bun is available (the server runs on Bun).
if ! command -v bun >/dev/null 2>&1; then
  echo "[orama-mcp] installing Bun..."
  # TODO: pin a Bun version; install to a system-wide location on PATH.
  curl -fsSL https://bun.sh/install | bash
fi

# 2. Install the MCP server so `orama-mcp` is on PATH.
# TODO: choose ONE distribution strategy and implement it:
#   (a) publish @quebi/orama-mcp to npm      -> `bun install -g @quebi/orama-mcp@${VERSION}`
#   (b) attach a compiled binary to releases -> download + chmod +x into /usr/local/bin
echo "[orama-mcp] TODO: install @quebi/orama-mcp@${VERSION}"

# 3. Install a `orama-mcp-register` helper used by postCreateCommand to merge
#    the server entry into the workspace .mcp.json (workspace is mounted by then).
#    Honors AUTOREGISTER and the GLOBS option.
# TODO: write /usr/local/bin/orama-mcp-register that:
#   - exits 0 immediately if AUTOREGISTER != true
#   - merges { mcpServers.orama = { command: "orama-mcp", args: ["--globs", "$GLOBS"] } }
#     into ${containerWorkspaceFolder}/.mcp.json (create if missing; don't clobber other servers)
echo "[orama-mcp] TODO: install orama-mcp-register helper (globs=${GLOBS})"

echo "[orama-mcp] done."
