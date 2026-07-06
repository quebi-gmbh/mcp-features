#!/usr/bin/env bash
# Dev Container Feature installer for lsp-mcp.
# Runs at image BUILD time. Options arrive as UPPERCASED env vars.
set -euo pipefail

VERSION="${VERSION:-latest}"
LANGUAGES="${LANGUAGES:-typescript,python}"
PORT="${PORT:-7337}"
AUTOREGISTER="${AUTOREGISTER:-true}"

echo "[lsp-mcp] installing (version=${VERSION}, languages=${LANGUAGES}, port=${PORT})"

# 1. Ensure Bun is available (the service runs on Bun).
if ! command -v bun >/dev/null 2>&1; then
  echo "[lsp-mcp] installing Bun..."
  # TODO: pin a Bun version; install to a system-wide location on PATH.
  curl -fsSL https://bun.sh/install | bash
fi

# 2. Install the requested language servers.
IFS=',' read -ra LANGS <<< "${LANGUAGES}"
for lang in "${LANGS[@]}"; do
  case "$(echo "$lang" | tr '[:upper:]' '[:lower:]' | xargs)" in
    typescript|ts|javascript|js)
      echo "[lsp-mcp] TODO: install typescript-language-server (MIT)"
      # e.g. npm i -g typescript typescript-language-server
      ;;
    python|py)
      echo "[lsp-mcp] TODO: install pyright-langserver (MIT)"
      # e.g. npm i -g pyright   (or pipx install python-lsp-server)
      ;;
    cpp|c++|c)
      echo "[lsp-mcp] c++ is not supported yet (needs compile_commands.json) — skipping"
      ;;
    *)
      echo "[lsp-mcp] unknown language '${lang}' — skipping"
      ;;
  esac
done

# 3. Install the MCP service so `lsp-mcp` is on PATH.
# TODO: publish @quebi/lsp-mcp to npm (bun install -g) OR ship a release binary.
echo "[lsp-mcp] TODO: install @quebi/lsp-mcp@${VERSION}"

# 4. Install a `lsp-mcp-register` helper (used by postCreateCommand) that merges
#    the HTTP server entry into the workspace .mcp.json, honoring AUTOREGISTER/PORT.
# TODO: write /usr/local/bin/lsp-mcp-register that:
#   - exits 0 if AUTOREGISTER != true
#   - merges { mcpServers.lsp = { type: "http", url: "http://127.0.0.1:${PORT}/mcp" } }
#     into ${containerWorkspaceFolder}/.mcp.json (create if missing; keep other servers)
echo "[lsp-mcp] TODO: install lsp-mcp-register helper (port=${PORT})"

# NOTE: the service itself is launched at container start via the Feature's
# postStartCommand (`lsp-mcp serve`), so language servers stay warm across sessions.

echo "[lsp-mcp] done."
