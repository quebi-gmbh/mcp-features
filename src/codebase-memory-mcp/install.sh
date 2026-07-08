#!/usr/bin/env bash
# Dev Container Feature installer for codebase-memory-mcp.
# Runs at image BUILD time (as root, before the workspace is mounted). Options
# arrive as UPPERCASED env vars.
set -euo pipefail

VERSION="${VERSION:-latest}"
UI="${UI:-false}"
AUTOINDEX="${AUTOINDEX:-false}"
AUTOREGISTER="${AUTOREGISTER:-true}"
INDEXONSTART="${INDEXONSTART:-true}"
INSTALL_DIR="/usr/local/bin"

echo "[codebase-memory-mcp] installing (version=${VERSION}, ui=${UI}, autoRegister=${AUTOREGISTER}, indexOnStart=${INDEXONSTART})"

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

# 5. Helper (run by postStartCommand, cwd = workspace folder) that makes an index
#    EXIST for the workspace so the MCP tools work out of the box. A fresh container
#    has an empty store, so the first search_graph/search_code/trace_path call returns
#    "No projects indexed" and the agent falls back to grep. This eagerly indexes the
#    workspace once, so the tools return structural results on the first call.
#
#    - Idempotent: skips if the workspace project is already in the store.
#    - "fast" mode: no similarity/semantic edges and NO .codebase-memory persistence
#      artifact (matches claude-manager's "no graph persistence" requirement).
#    - Non-blocking: runs in the background so it never holds up container start or
#      the agent's first tool call.
cat > /usr/local/bin/codebase-memory-mcp-index << EOF
#!/usr/bin/env bash
set -euo pipefail
[ "${INDEXONSTART}" = "true" ] || exit 0
command -v codebase-memory-mcp >/dev/null 2>&1 || exit 0

# Project name is derived from the absolute path the way codebase-memory-mcp does it:
# strip the leading slash, then replace remaining slashes with dashes.
proj="\$(printf '%s' "\${PWD}" | sed 's#^/##; s#/#-#g')"

# Idempotent guard: if the workspace project is already indexed, do nothing.
if codebase-memory-mcp cli list_projects '{}' 2>/dev/null | grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"\${proj}\""; then
  echo "[codebase-memory-mcp] workspace already indexed (\${proj}); skipping"
  exit 0
fi

# "fast" mode: no similarity/semantic edges, no .codebase-memory persistence artifact.
payload="{\"repo_path\":\"\${PWD}\",\"mode\":\"fast\"}"
echo "[codebase-memory-mcp] indexing workspace \${PWD} (mode=fast) in the background..."
nohup codebase-memory-mcp cli index_repository "\${payload}" >/tmp/codebase-memory-mcp-index.log 2>&1 &
EOF
chmod +x /usr/local/bin/codebase-memory-mcp-index

echo "[codebase-memory-mcp] done."
