#!/usr/bin/env bash
set -euo pipefail

# devcontainers CLI feature test. Provided by the test harness:
source dev-container-features-test-lib

check "codebase-memory-mcp on PATH" bash -c "command -v codebase-memory-mcp"
check "codebase-memory-mcp --version" bash -c "codebase-memory-mcp --version"
check "codebase-memory-mcp-register installed" bash -c "test -x /usr/local/bin/codebase-memory-mcp-register"
check "codebase-memory-mcp-index installed" bash -c "test -x /usr/local/bin/codebase-memory-mcp-index"

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

# Registration must be best-effort: an unwritable workspace root (e.g. a fresh
# root-owned named-volume workspace) must NOT fail the postCreateCommand and
# abort container setup. Simulate an unwritable target by making .mcp.json a
# directory (write fails regardless of the user the test runs as).
check "register degrades gracefully when .mcp.json is unwritable" bash -c '
  d=/tmp/cbm-test-ro
  rm -rf "$d"; mkdir -p "$d/.mcp.json"
  cd "$d"
  codebase-memory-mcp-register   # must exit 0 (warn + skip), not abort
'

# Lifecycle indexing (postStartCommand): the helper indexes the workspace so the
# MCP tools work out of the box, and is idempotent on re-run.
check "index helper indexes the workspace" bash -c '
  cd /tmp/cbm-test-workspace
  printf "def hello():\n    return 1\n" > sample.py
  codebase-memory-mcp-index
  # helper dispatches indexing in the background; wait for the store to populate.
  proj="$(printf "%s" "$PWD" | sed "s#^/##; s#/#-#g")"
  for _ in $(seq 1 30); do
    if codebase-memory-mcp cli list_projects "{}" 2>/dev/null | grep -q "$proj"; then
      exit 0
    fi
    sleep 1
  done
  echo "workspace was not indexed within timeout" >&2
  codebase-memory-mcp cli list_projects "{}" >&2 || true
  exit 1
'

check "index helper is idempotent (no re-index when already indexed)" bash -c '
  cd /tmp/cbm-test-workspace
  codebase-memory-mcp-index | grep -q "already indexed"
'

check "fast mode leaves no in-workspace persistence artifact" bash -c '
  test ! -e /tmp/cbm-test-workspace/.codebase-memory/graph.db.zst
'

reportResults
