#!/usr/bin/env bash
# Dev Container Feature installer for lsp-mcp.
# Runs at image BUILD time (as root, before the workspace is mounted). Options
# arrive as UPPERCASED env vars. Installs Serena (https://github.com/oraios/serena,
# MIT) and two small wrapper scripts that bake in this feature's resolved options,
# since postStartCommand/postCreateCommand are static strings with no access to them.
set -euo pipefail

VERSION="${VERSION:-latest}"
PYTHONVERSION="${PYTHONVERSION:-3.13}"
PORT="${PORT:-7337}"
ENABLEWEBDASHBOARD="${ENABLEWEBDASHBOARD:-false}"
AUTOREGISTER="${AUTOREGISTER:-true}"

echo "[lsp-mcp] installing (version=${VERSION}, port=${PORT}, autoRegister=${AUTOREGISTER})"

# System-wide install locations so the tool works regardless of which user the
# container ends up running as at runtime (install.sh itself runs as root).
export UV_INSTALL_DIR="/usr/local/bin"
export UV_TOOL_BIN_DIR="/usr/local/bin"
export UV_TOOL_DIR="/usr/local/share/uv-tools"

# 1. Ensure uv is available (Serena is managed by uv; see its Quick Start).
if ! command -v uv >/dev/null 2>&1; then
  echo "[lsp-mcp] installing uv..."
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi

# 2. jq is used by the .mcp.json register helper; best-effort install if missing.
if ! command -v jq >/dev/null 2>&1; then
  echo "[lsp-mcp] installing jq..."
  (apt-get update -qq && apt-get install -y -qq jq) || echo "[lsp-mcp] warning: could not install jq; registration will be skipped at runtime"
fi

# 3. Install Serena (language-server backend; auto-downloads/manages the
#    per-language servers it needs, including for TypeScript and Python).
if [ "${VERSION}" = "latest" ]; then
  SERENA_PKG="serena-agent"
else
  SERENA_PKG="serena-agent==${VERSION}"
fi
echo "[lsp-mcp] installing ${SERENA_PKG} (python ${PYTHONVERSION})..."
uv tool install --python "${PYTHONVERSION}" "${SERENA_PKG}"

# Make the installed tool tree readable/executable by any runtime user.
chmod -R a+rX "${UV_TOOL_DIR}" 2>/dev/null || true

# 4. Create Serena's global config (no project needed yet; the workspace isn't
#    mounted at build time).
serena init --language-backend LSP

# 5. Wrapper that starts Serena as a long-lived streamable-HTTP MCP service,
#    keeping the language servers it spawns warm across agent sessions.
#    `--project-from-cwd` activates the project from the lifecycle command's cwd,
#    which the dev container spec sets to the workspace folder.
cat > /usr/local/bin/lsp-mcp-serve << EOF
#!/usr/bin/env bash
set -euo pipefail
exec serena start-mcp-server \\
  --transport streamable-http \\
  --host 127.0.0.1 \\
  --port ${PORT} \\
  --project-from-cwd \\
  --enable-web-dashboard ${ENABLEWEBDASHBOARD} \\
  --open-web-dashboard false
EOF
chmod +x /usr/local/bin/lsp-mcp-serve

# 6. Helper (run by postCreateCommand, cwd = workspace folder by then) that merges
#    the HTTP server entry into the workspace .mcp.json, honoring AUTOREGISTER.
cat > /usr/local/bin/lsp-mcp-register << EOF
#!/usr/bin/env bash
set -euo pipefail
[ "${AUTOREGISTER}" = "true" ] || exit 0
command -v jq >/dev/null 2>&1 || { echo "[lsp-mcp] jq not found, skipping .mcp.json registration" >&2; exit 0; }

mcp_json="\${PWD}/.mcp.json"
[ -f "\${mcp_json}" ] || echo '{}' > "\${mcp_json}"

tmp="\$(mktemp)"
jq --arg url "http://127.0.0.1:${PORT}/mcp" '.mcpServers.lsp = {type: "http", url: \$url}' "\${mcp_json}" > "\${tmp}"
mv "\${tmp}" "\${mcp_json}"
echo "[lsp-mcp] registered lsp server (http://127.0.0.1:${PORT}/mcp) in \${mcp_json}"
EOF
chmod +x /usr/local/bin/lsp-mcp-register

echo "[lsp-mcp] done."
