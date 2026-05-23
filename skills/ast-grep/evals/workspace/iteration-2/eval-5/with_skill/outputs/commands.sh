#!/usr/bin/env bash
# ============================================================================
# Command Script: ast-grep import search
# Eval: iteration-2/eval-5/with_skill
# Task: Find all imports from '../../core', '../../shared', or '../../common'
#       in all TypeScript files under the current directory, with JSON output.
# ============================================================================

# Step 1: Search all imports with JSON output
# Pattern matches: import { ... } from "..."
# Meta-variables used:
#   $$$  - Multi meta-variable: matches zero or more AST nodes (the imported names)
#   $MODULE - Single meta-variable: matches exactly one AST node (the module specifier string)
# Note: $MODULE is NOT quoted with "$MODULE" because the string node in the AST
# already includes the surrounding single/double quotes.
sg -p 'import { $$$ } from $MODULE' --json -l ts fixtures/

# Step 2: Filter results for ../../core/, ../../shared/, or ../../common/
# Pipe JSON output through Python to filter module paths
sg -p 'import { $$$ } from $MODULE' --json -l ts fixtures/ | python3 -c "
import sys, json
data = json.load(sys.stdin)
filtered = [item for item in data if item['metaVariables']['single']['MODULE']['text'].startswith(\"'../../core/\") or item['metaVariables']['single']['MODULE']['text'].startswith(\"'../../shared/\") or item['metaVariables']['single']['MODULE']['text'].startswith(\"'../../common/\")]
print(json.dumps(filtered, indent=2))
"
