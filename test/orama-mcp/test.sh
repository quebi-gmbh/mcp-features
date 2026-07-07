#!/usr/bin/env bash
set -euo pipefail

# devcontainers CLI feature test. Provided by the test harness:
source dev-container-features-test-lib

check "bun on PATH" bash -c "command -v bun"
check "orama-mcp on PATH" bash -c "command -v orama-mcp"
check "orama-mcp-register installed" bash -c "test -x /usr/local/bin/orama-mcp-register"

# Index a small fixture and drive a real stdio MCP round-trip. orama-mcp exits when
# its stdin closes (matching a real MCP client's lifecycle), so a naive one-shot
# pipe would race indexing/embedding of the fixture file — a FIFO keeps stdin open
# long enough for that first index pass (including the one-time embedding-model
# download) to finish, then we close it and let the process exit on its own.
mkdir -p /tmp/orama-test-fixture
cat > /tmp/orama-test-fixture/note.md << 'MD'
# Rollback Procedure

If a release breaks CI, revert the merge commit and re-run the publish workflow.
MD

check "stdio MCP handshake indexes and searches a fixture file" bash -c '
  set -e
  rm -f /tmp/orama-test.in
  mkfifo /tmp/orama-test.in
  timeout 90 orama-mcp --root /tmp/orama-test-fixture --globs "**/*.md" \
    < /tmp/orama-test.in > /tmp/orama-test-out.txt 2>/tmp/orama-test-err.txt &
  SERVER_PID=$!
  exec 3>/tmp/orama-test.in

  echo "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2024-11-05\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0\"}}}" >&3
  echo "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}" >&3
  sleep 45
  echo "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"search_knowledge\",\"arguments\":{\"query\":\"how to rollback a release\"}}}" >&3
  sleep 3

  exec 3>&-
  wait "$SERVER_PID" 2>/dev/null || true
  grep -q "note.md" /tmp/orama-test-out.txt
'

# .mcp.json registration
mkdir -p /tmp/orama-test-workspace
cd /tmp/orama-test-workspace
orama-mcp-register
check ".mcp.json registered" bash -c 'grep -q "orama-mcp" /tmp/orama-test-workspace/.mcp.json'

reportResults
