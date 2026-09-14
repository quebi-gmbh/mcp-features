#!/usr/bin/env bash
set -euo pipefail

# devcontainers CLI feature test. Provided by the test harness:
source dev-container-features-test-lib

PORT=7338
FIXTURE=/tmp/orama-test-fixture

check "bun on PATH" bash -c "command -v bun"
check "orama-mcp on PATH" bash -c "command -v orama-mcp"
check "orama-mcp-serve installed" bash -c "test -x /usr/local/bin/orama-mcp-serve"
check "orama-mcp-register installed" bash -c "test -x /usr/local/bin/orama-mcp-register"

mkdir -p "${FIXTURE}"
cat > "${FIXTURE}/note.md" << 'MD'
# Rollback Procedure

If a release breaks CI, revert the merge commit and re-run the publish workflow.
MD

# ---------------------------------------------------------------------------
# 1. stdio round-trip. Deliberately FIRST: it pays the one-time embedding-model
#    download into ${FIXTURE}/.orama-cache, which the HTTP run below then reuses.
# ---------------------------------------------------------------------------

# orama-mcp exits when its stdin closes (matching a real MCP client's lifecycle),
# so a naive one-shot pipe would race indexing/embedding of the fixture file — a
# FIFO keeps stdin open long enough for that first index pass (including the
# model download) to finish, then we close it and let the process exit on its own.
check "stdio MCP handshake indexes and searches a fixture file" bash -c '
  set -e
  rm -f /tmp/orama-test.in
  mkfifo /tmp/orama-test.in
  timeout 90 orama-mcp --root '"${FIXTURE}"' --globs "**/*.md" \
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

# ---------------------------------------------------------------------------
# 2. HTTP round-trip against the ONE shared service, driven the way
#    postStartCommand would. Skipped (not failed) when the feature was installed
#    with transport: stdio, where orama-mcp-serve is a no-op by design.
# ---------------------------------------------------------------------------
cd "${FIXTURE}"
nohup orama-mcp-serve >/tmp/orama-mcp-test.log 2>&1 &
sleep 2

if grep -q "no shared service to start" /tmp/orama-mcp-test.log 2>/dev/null; then
  echo "[test] transport=stdio: skipping the shared-HTTP-service checks"
else
  check "shared HTTP service becomes ready and reports the indexed file" bash -c '
    for i in $(seq 1 180); do
      curl -sf "http://127.0.0.1:'"${PORT}"'/healthz" 2>/dev/null | grep -q "\"files\":1" && exit 0
      sleep 1
    done
    cat /tmp/orama-mcp-test.log >&2
    exit 1
  '

  check "HTTP client initializes, gets a session id, and searches" bash -c '
    set -e
    curl -sf -D /tmp/orama-http-h1.txt -o /tmp/orama-http-b1.txt \
      -X POST "http://127.0.0.1:'"${PORT}"'/mcp" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test\",\"version\":\"0\"}}}"
    grep -q "serverInfo" /tmp/orama-http-b1.txt

    SID=$(tr -d "\r" < /tmp/orama-http-h1.txt | awk "tolower(\$1) == \"mcp-session-id:\" { print \$2 }")
    test -n "$SID"
    echo "$SID" > /tmp/orama-http-sid.txt

    curl -sf -X POST "http://127.0.0.1:'"${PORT}"'/mcp" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -H "mcp-session-id: $SID" \
      -d "{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}"

    curl -sf -X POST "http://127.0.0.1:'"${PORT}"'/mcp" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -H "mcp-session-id: $SID" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"search_knowledge\",\"arguments\":{\"query\":\"how to rollback a release\"}}}" \
      | tee /tmp/orama-http-search.txt | grep -q "note.md"
  '

  # The whole point: a SECOND client is a second session on the SAME process and
  # the same index — not a second 557 MB copy of it.
  check "a second client gets its own session on the same shared process" bash -c '
    set -e
    curl -sf -D /tmp/orama-http-h2.txt -o /dev/null \
      -X POST "http://127.0.0.1:'"${PORT}"'/mcp" \
      -H "Content-Type: application/json" \
      -H "Accept: application/json, text/event-stream" \
      -d "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"initialize\",\"params\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{},\"clientInfo\":{\"name\":\"test2\",\"version\":\"0\"}}}"

    SID2=$(tr -d "\r" < /tmp/orama-http-h2.txt | awk "tolower(\$1) == \"mcp-session-id:\" { print \$2 }")
    test -n "$SID2"
    test "$SID2" != "$(cat /tmp/orama-http-sid.txt)"

    curl -sf "http://127.0.0.1:'"${PORT}"'/healthz" | grep -q "\"sessions\":2"
  '

  check "a second orama-mcp on the same port exits 0 instead of crashing" bash -c '
    cd '"${FIXTURE}"'
    timeout 60 orama-mcp-serve >/tmp/orama-mcp-second.log 2>&1
    grep -q "already in use" /tmp/orama-mcp-second.log
  '
fi

# ---------------------------------------------------------------------------
# 3. .mcp.json registration (shape follows the configured transport).
# ---------------------------------------------------------------------------
mkdir -p /tmp/orama-test-workspace
cd /tmp/orama-test-workspace
orama-mcp-register
check ".mcp.json registered with a valid entry for the configured transport" bash -c '
  jq -e ".mcpServers.orama
          | (.type == \"http\" and (.url | test(\"^http://127\\\\.0\\\\.0\\\\.1:[0-9]+/mcp$\")))
            or (.command == \"orama-mcp\")" \
    /tmp/orama-test-workspace/.mcp.json
'

reportResults
