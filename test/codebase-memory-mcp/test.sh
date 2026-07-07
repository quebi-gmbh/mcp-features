#!/usr/bin/env bash
set -euo pipefail

# devcontainers CLI feature test. Provided by the test harness:
source dev-container-features-test-lib

check "codebase-memory-mcp on PATH" bash -c "command -v codebase-memory-mcp"
check "codebase-memory-mcp --version" bash -c "codebase-memory-mcp --version"
check "codebase-memory-mcp-register installed" bash -c "test -x /usr/local/bin/codebase-memory-mcp-register"

# Drive a real stdio MCP handshake (initialize -> initialized -> tools/list),
# the same sequence a real MCP client speaks, and confirm the tool set comes back.
check "stdio MCP handshake responds with tools" bash -c '
  printf "%s\n%s\n%s\n" \
    "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0\"}}}" \
    "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}" \
    "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/list\"}" \
    | timeout 15 codebase-memory-mcp | grep -q "index_repository"
'

# .mcp.json registration
mkdir -p /tmp/cbm-test-workspace
cd /tmp/cbm-test-workspace
codebase-memory-mcp-register
check ".mcp.json registered" bash -c 'grep -q "codebase-memory-mcp" /tmp/cbm-test-workspace/.mcp.json'

reportResults
