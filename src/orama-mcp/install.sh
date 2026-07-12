#!/usr/bin/env bash
# Dev Container Feature installer for orama-mcp.
# Runs at image BUILD time (as root, before the workspace is mounted). Options
# arrive as UPPERCASED env vars.
set -euo pipefail

VERSION="${VERSION:-latest}"
GLOBS="${GLOBS:-**/*.md,**/*.jsonl,**/*.pdf}"
OCR="${OCR:-false}"
AUTOREGISTER="${AUTOREGISTER:-true}"
REF="${VERSION}"
[ "${REF}" = "latest" ] && REF="main"

REPO_URL="https://github.com/quebi-gmbh/mcp-features.git"
SRC_DIR="/opt/orama-mcp-src"
PKG_DIR="${SRC_DIR}/packages/orama-mcp"

echo "[orama-mcp] installing (ref=${REF}, globs=${GLOBS}, ocr=${OCR}, autoRegister=${AUTOREGISTER})"

# 1. Ensure git is available (needed to fetch packages/orama-mcp's source; it isn't
#    published to a registry yet).
if ! command -v git >/dev/null 2>&1; then
  echo "[orama-mcp] installing git..."
  (apt-get update -qq && apt-get install -y -qq git) || {
    echo "[orama-mcp] error: git is required and could not be installed" >&2
    exit 1
  }
fi

# 2. jq is used by the .mcp.json register helper; best-effort install if missing.
if ! command -v jq >/dev/null 2>&1; then
  echo "[orama-mcp] installing jq..."
  (apt-get update -qq && apt-get install -y -qq jq) || echo "[orama-mcp] warning: could not install jq; registration will be skipped at runtime"
fi

# 3. Ensure Bun is available (the server runs on Bun), system-wide so it works
#    regardless of which user the container runs as at runtime.
if ! command -v bun >/dev/null 2>&1; then
  echo "[orama-mcp] installing bun..."
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
fi

# 4. Fetch just packages/orama-mcp from this repo (not published to npm yet) via a
#    blobless sparse clone, then check out the requested ref (branch, tag, or commit).
rm -rf "${SRC_DIR}"
git clone --filter=blob:none --no-checkout --quiet "${REPO_URL}" "${SRC_DIR}"
git -C "${SRC_DIR}" sparse-checkout set packages/orama-mcp
git -C "${SRC_DIR}" checkout --quiet "${REF}"

# 5. Install dependencies (this pulls in @huggingface/transformers + onnxruntime-node,
#    which bundle prebuilt native binaries for common platforms -- no extra system
#    toolchain needed) and build. dist/index.js must keep running from inside this
#    directory: onnxruntime-node's native binary is resolved via a relative path from
#    its own package location, which breaks if bundled, so it (and its onnxruntime-common
#    dependency, and sharp, and @huggingface/transformers) are marked --external in the
#    build script and must stay unbundled alongside node_modules.
cd "${PKG_DIR}"
bun install --production
bun run build

# 5b. OCR is opt-in: tesseract.js is loaded via a lazy, computed import (not a
#     package dependency, never bundled), so it must be installed here when
#     requested. Skipped by default to keep the image lean.
if [ "${OCR}" = "true" ]; then
  echo "[orama-mcp] ocr enabled: installing tesseract.js..."
  bun add tesseract.js
fi

chmod -R a+rX "${SRC_DIR}"

# 6. Wrapper that runs the built server from its install location.
cat > /usr/local/bin/orama-mcp << EOF
#!/usr/bin/env bash
set -euo pipefail
exec bun run "${PKG_DIR}/dist/index.js" "\$@"
EOF
chmod +x /usr/local/bin/orama-mcp

# 7. Helper (run by postCreateCommand, cwd = workspace folder by then) that merges
#    the stdio server entry into the workspace .mcp.json, honoring AUTOREGISTER.
cat > /usr/local/bin/orama-mcp-register << EOF
#!/usr/bin/env bash
set -euo pipefail
[ "${AUTOREGISTER}" = "true" ] || exit 0
command -v jq >/dev/null 2>&1 || { echo "[orama-mcp] jq not found, skipping .mcp.json registration" >&2; exit 0; }

mcp_json="\${PWD}/.mcp.json"
[ -f "\${mcp_json}" ] || echo '{}' > "\${mcp_json}"

tmp="\$(mktemp)"
jq --arg globs "${GLOBS}" --argjson ocr ${OCR} \
  '.mcpServers.orama = {command: "orama-mcp", args: (["--globs", \$globs] + (if \$ocr then ["--ocr"] else [] end))}' \
  "\${mcp_json}" > "\${tmp}"
mv "\${tmp}" "\${mcp_json}"
echo "[orama-mcp] registered orama server in \${mcp_json}"
EOF
chmod +x /usr/local/bin/orama-mcp-register

echo "[orama-mcp] done."
