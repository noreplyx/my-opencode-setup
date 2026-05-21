#!/bin/bash
# Simple test runner for orchestration system tests
set -e

echo "🧪 Orchestration System Tests"
echo "================================"
echo ""

# Find and run all test files
TEST_DIR="$(dirname "$0")"
PASSED=0
FAILED=0

for test_file in "$TEST_DIR"/*.test.ts; do
  if [ -f "$test_file" ]; then
    test_name=$(basename "$test_file" .test.ts)
    echo "▶ Running: $test_name"
    echo ""
    
    if npx ts-node "$test_file" 2>&1; then
      echo ""
      echo "  ✅ $test_name PASSED"
      echo ""
      PASSED=$((PASSED + 1))
    else
      echo ""
      echo "  ❌ $test_name FAILED"
      echo ""
      FAILED=$((FAILED + 1))
    fi
  fi
done

echo "================================"
echo "Results: $PASSED passed, $FAILED failed, $((PASSED + FAILED)) total"

if [ "$FAILED" -gt 0 ]; then
  exit 1
fi
