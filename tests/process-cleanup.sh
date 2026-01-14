#!/bin/bash
set -e

TEST_PORT=19876
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

# Create temp spec file
SPEC_FILE=$(mktemp --suffix=.yaml)
cat > "$SPEC_FILE" << 'EOF'
openapi: "3.1.0"
info:
  title: Test
  version: "1.0.0"
paths:
  /health:
    get:
      responses:
        "200":
          description: OK
EOF

cleanup() {
  rm -f "$SPEC_FILE"
  for i in {0..5}; do
    kill -9 $(lsof -t -i:$((TEST_PORT + i)) 2>/dev/null) 2>/dev/null || true
  done
}
trap cleanup EXIT

test_signal() {
  local mode=$1
  local signal=$2
  local port=$3
  echo "Testing $mode with $signal on port $port..."

  if [ "$mode" = "deno" ]; then
    deno run --allow-read --allow-net --allow-env cmd/steady.ts --no-log --port "$port" "$SPEC_FILE" >/dev/null 2>&1 &
  elif [ "$mode" = "npm" ]; then
    node npm/cli/steady.js --no-log --port "$port" "$SPEC_FILE" >/dev/null 2>&1 &
  fi
  SERVER_PID=$!

  # Wait for server to start
  for i in {1..50}; do
    if curl -s "http://localhost:$port/health" >/dev/null 2>&1; then
      break
    fi
    sleep 0.1
  done

  if ! curl -s "http://localhost:$port/health" >/dev/null 2>&1; then
    echo "  FAIL: Server did not start"
    kill $SERVER_PID 2>/dev/null || true
    return 1
  fi

  echo "  Server started (PID $SERVER_PID)"

  # Send signal
  kill -"$signal" $SERVER_PID
  echo "  Sent $signal to $SERVER_PID"

  # Wait for process to exit
  for i in {1..50}; do
    if ! kill -0 $SERVER_PID 2>/dev/null; then
      echo "  PASS: Process exited after $signal"
      return 0
    fi
    sleep 0.1
  done

  echo "  FAIL: Process still running after $signal"
  kill -9 $SERVER_PID 2>/dev/null || true
  return 1
}

# Check npm package exists
if [ ! -f "npm/cli/steady.js" ]; then
  echo "Building npm package first..."
  deno run -A scripts/build_npm.ts --platform linux-x64 >/dev/null 2>&1
fi

echo "=== Process Cleanup Tests ==="
echo

echo "--- Deno direct ---"
test_signal deno TERM $TEST_PORT
test_signal deno INT $((TEST_PORT + 1))
test_signal deno HUP $((TEST_PORT + 2))

echo
echo "--- npm wrapper ---"
test_signal npm TERM $((TEST_PORT + 3))
test_signal npm INT $((TEST_PORT + 4))
test_signal npm HUP $((TEST_PORT + 5))

echo
echo "All tests passed!"
