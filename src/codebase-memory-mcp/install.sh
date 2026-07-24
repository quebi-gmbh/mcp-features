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

# 2. Install the binary by downloading the release artifact directly (we do our
#    own MCP registration below for consistency with the other features in this
#    repo). Deliberately NOT piping upstream main's install.sh: its logic tracks
#    upstream main and can change under us between builds, whereas a pinned
#    VERSION here pins everything — download URL, checksum, and install steps.
case "$(uname -m)" in
  x86_64) ARCH="amd64" ;;
  aarch64 | arm64) ARCH="arm64" ;;
  *)
    echo "[codebase-memory-mcp] error: unsupported architecture: $(uname -m)" >&2
    exit 1
    ;;
esac

VARIANT="codebase-memory-mcp"
if [ "${UI}" = "true" ]; then
  VARIANT="codebase-memory-mcp-ui"
fi
ASSET="${VARIANT}-linux-${ARCH}-portable.tar.gz"

if [ "${VERSION}" = "latest" ]; then
  BASE_URL="https://github.com/DeusData/codebase-memory-mcp/releases/latest/download"
else
  BASE_URL="https://github.com/DeusData/codebase-memory-mcp/releases/download/${VERSION}"
fi

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

echo "[codebase-memory-mcp] downloading ${BASE_URL}/${ASSET}"
curl -fsSL -o "${TMP_DIR}/${ASSET}" "${BASE_URL}/${ASSET}"
curl -fsSL -o "${TMP_DIR}/checksums.txt" "${BASE_URL}/checksums.txt"
(cd "${TMP_DIR}" && grep "[[:space:]]${ASSET}\$" checksums.txt | sha256sum -c -)

# Both variants' tarballs ship the binary as a flat "codebase-memory-mcp" entry.
tar -xzf "${TMP_DIR}/${ASSET}" -C "${TMP_DIR}" codebase-memory-mcp
install -m 0755 "${TMP_DIR}/codebase-memory-mcp" "${INSTALL_DIR}/codebase-memory-mcp"

codebase-memory-mcp --version

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

# Best-effort from here down. The workspace root may be unwritable for the
# remote user — e.g. a freshly-created named-volume workspace mounts root-owned,
# or .mcp.json is owned by another tool (claude-manager, etc.). Registration is
# a convenience, not a prerequisite: a failure here must NEVER fail the
# postCreateCommand, which would abort the whole container setup (skipping every
# later user command). Warn and exit 0 instead.
if ! { [ -f "\${mcp_json}" ] || echo '{}' 2>/dev/null > "\${mcp_json}"; }; then
  echo "[codebase-memory-mcp] \${mcp_json} not writable; skipping registration" >&2
  exit 0
fi

tmp="\$(mktemp)"
if jq '.mcpServers["codebase-memory"] = {command: "codebase-memory-mcp", args: []}' "\${mcp_json}" > "\${tmp}" 2>/dev/null && mv "\${tmp}" "\${mcp_json}" 2>/dev/null; then
  echo "[codebase-memory-mcp] registered codebase-memory server in \${mcp_json}"
else
  rm -f "\${tmp}"
  echo "[codebase-memory-mcp] could not update \${mcp_json}; skipping registration" >&2
  exit 0
fi
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
