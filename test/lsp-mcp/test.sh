#!/usr/bin/env bash
set -euo pipefail

# devcontainers CLI feature test. Provided by the test harness:
source dev-container-features-test-lib

# TODO: real assertions once install.sh is implemented, e.g.:
#   check "lsp-mcp on PATH"        bash -c "command -v lsp-mcp"
#   check "typescript-language-server" bash -c "command -v typescript-language-server"
#   check "health endpoint"        bash -c "curl -sf http://127.0.0.1:7337/health"
check "placeholder" bash -c "true"

reportResults
