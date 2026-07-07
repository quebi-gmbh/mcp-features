#!/usr/bin/env bash
set -euo pipefail

# devcontainers CLI feature test. Provided by the test harness:
source dev-container-features-test-lib

check "uv on PATH" bash -c "command -v uv"
check "serena on PATH" bash -c "command -v serena"
check "lsp-mcp-serve installed" bash -c "test -x /usr/local/bin/lsp-mcp-serve"
check "lsp-mcp-register installed" bash -c "test -x /usr/local/bin/lsp-mcp-register"

# Drive the service the same way postStartCommand/postCreateCommand would, rather
# than relying on the test harness to fire dev container lifecycle hooks itself.
mkdir -p /tmp/lsp-mcp-test-workspace
cd /tmp/lsp-mcp-test-workspace
nohup lsp-mcp-serve >/tmp/lsp-mcp-test.log 2>&1 &

check "streamable-http MCP endpoint responds" bash -c '
  for i in $(seq 1 30); do
    resp=$(curl -sf -X POST http://127.0.0.1:7337/mcp \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0\"}}}" 2>/dev/null) \
      && echo "$resp" | grep -q "serverInfo" && exit 0
    sleep 1
  done
  cat /tmp/lsp-mcp-test.log >&2
  exit 1
'

cd /tmp/lsp-mcp-test-workspace
lsp-mcp-register
check ".mcp.json registered" bash -c 'grep -q "127.0.0.1:7337/mcp" /tmp/lsp-mcp-test-workspace/.mcp.json'

reportResults
