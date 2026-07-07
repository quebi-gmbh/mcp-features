#!/usr/bin/env bash
# Dev Container Feature installer for codebase-memory-mcp.
# Runs at image BUILD time (as root, before the workspace is mounted). Options
# arrive as UPPERCASED env vars.
set -euo pipefail

VERSION="${VERSION:-latest}"
UI="${UI:-false}"
AUTOINDEX="${AUTOINDEX:-false}"
AUTOREGISTER="${AUTOREGISTER:-true}"
INSTALL_DIR="/usr/local/bin"

echo "[codebase-memory-mcp] installing (version=${VERSION}, ui=${UI}, autoRegister=${AUTOREGISTER})"

# 1. jq is used by the .mcp.json register helper; best-effort install if missing.
if ! command -v jq >/dev/null 2>&1; then
  echo "[codebase-memory-mcp] installing jq..."
  (apt-get update -qq && apt-get install -y -qq jq) || echo "[codebase-memory-mcp] warning: could not install jq; registration will be skipped at runtime"
fi

# 2. Install the binary via the project's own installer: it detects OS/arch,
#    verifies the release checksum, and (with --skip-config) installs only the
#    binary — we do our own MCP registration below for consistency with the
#    other features in this repo.
INSTALL_ARGS=(--dir="${INSTALL_DIR}" --skip-config)
if [ "${UI}" = "true" ]; then
  INSTALL_ARGS+=(--ui)
fi

# CBM_DOWNLOAD_URL lets us pin an exact release instead of always "latest"
# (the upstream installer only supports latest/download by default).
if [ "${VERSION}" != "latest" ]; then
  export CBM_DOWNLOAD_URL="https://github.com/DeusData/codebase-memory-mcp/releases/download/${VERSION}"
fi

curl -fsSL https://raw.githubusercontent.com/DeusData/codebase-memory-mcp/main/install.sh | bash -s -- "${INSTALL_ARGS[@]}"

# 3. Global config (no project needed yet; the workspace isn't mounted at build time).
codebase-memory-mcp config set auto_index "${AUTOINDEX}"

# 4. Helper (run by postCreateCommand, cwd = workspace folder by then) that merges
#    the stdio server entry into the workspace .mcp.json, honoring AUTOREGISTER.
cat > /usr/local/bin/codebase-memory-mcp-register << EOF
#!/usr/bin/env bash
set -euo pipefail
[ "${AUTOREGISTER}" = "true" ] || exit 0
command -v jq >/dev/null 2>&1 || { echo "[codebase-memory-mcp] jq not found, skipping .mcp.json registration" >&2; exit 0; }

mcp_json="\${PWD}/.mcp.json"
[ -f "\${mcp_json}" ] || echo '{}' > "\${mcp_json}"

tmp="\$(mktemp)"
jq '.mcpServers["codebase-memory"] = {command: "codebase-memory-mcp", args: []}' "\${mcp_json}" > "\${tmp}"
mv "\${tmp}" "\${mcp_json}"
echo "[codebase-memory-mcp] registered codebase-memory server in \${mcp_json}"
EOF
chmod +x /usr/local/bin/codebase-memory-mcp-register

echo "[codebase-memory-mcp] done."
