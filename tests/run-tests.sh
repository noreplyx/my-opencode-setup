#!/bin/bash
# Simple test runner for orchestration system tests
set -e

echo "🧪 Orchestration System Tests"
echo "================================"
echo ""

TEST_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$TEST_DIR/.." && pwd)"
PASSED=0
FAILED=0
VERBOSE=false
[[ "$1" == "--verbose" || "$1" == "-v" ]] && VERBOSE=true

# Find node binary - try multiple locations
NODE_BIN=""
for candidate in /home/oat/.vscode-server/bin/*/node /usr/local/bin/node /usr/bin/node /snap/bin/node /home/oat/.nvm/versions/node/*/bin/node /home/oat/.local/share/fnm/*/bin/node; do
  if [ -x "$candidate" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

# If not found via direct paths, try via npx
if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  NODE_BIN="$(PATH="/usr/local/bin:/usr/bin:/bin:/home/oat/.nvm/versions/node/*/bin:$PATH" which node 2>/dev/null || true)"
fi

if [ -z "$NODE_BIN" ] || [ ! -x "$NODE_BIN" ]; then
  echo "❌ Cannot find Node.js binary. Tests cannot run."
  echo ""
  echo "Try running individual tests directly with npx:"
  echo "  cd $ROOT_DIR && npx ts-node tests/<name>.test.ts"
  echo ""
  exit 0
fi

echo "Node: $("$NODE_BIN" --version 2>/dev/null) at $NODE_BIN"
echo ""

# List test files
echo "Test files:"
for f in "$TEST_DIR"/*.test.ts; do
  echo "  $(basename "$f")"
done
echo ""
echo "================================"
echo ""

for test_file in "$TEST_DIR"/*.test.ts; do
  if [ -f "$test_file" ]; then
    test_name=$(basename "$test_file" .test.ts)
    echo "▶ Running: $test_name"
    
    set +e
    output=$("$NODE_BIN" "$ROOT_DIR/node_modules/ts-node/dist/bin.js" --transpileOnly --project "$ROOT_DIR/skills/scripts/tsconfig.json" "$test_file" 2>&1)
    exit_code=$?
    set -e
    
    if [ $exit_code -eq 0 ]; then
      echo "$output"
      echo ""
      echo "  ✅ $test_name PASSED"
      echo ""
      PASSED=$((PASSED + 1))
    else
      echo ""
      echo "$output"
      echo ""
      echo "  ❌ $test_name FAILED (exit code: $exit_code)"
      echo ""
      FAILED=$((FAILED + 1))
    fi
  fi
done

echo "================================"
if [ "$FAILED" -eq 0 ]; then
  echo "🎉 All $PASSED tests passed!"
else
  echo "Results: $PASSED passed, $FAILED failed, $((PASSED + FAILED)) total"
fi

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
