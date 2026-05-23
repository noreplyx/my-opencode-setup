#!/bin/bash
# Eval 5: JSON Import Search — ast-grep (without skill)
# Find all imports from '../../core', '../../shared', or '../../common' in TypeScript files
# Uses JSON output for piping to other tools

# Step 1: Search all named imports with meta-variables $A (imported name) and $VALUE (module path)
# Pattern: import { $A } from '$VALUE'
# Note: Quote style in pattern must match source file (single-quotes here because fixtures use ')

ast-grep -p "import { \$A } from '\$VALUE'" -l ts --json fixtures/

# Step 2: Pipe the JSON output through a filter to keep only imports from ../../core, ../../shared, or ../../common
# Approach: Filter on metaVariables.single.VALUE.text starting with the target prefixes
# This uses python3 as a JSON filter (jq alternative)

ast-grep -p "import { \$A } from '\$VALUE'" -l ts --json fixtures/ | \
  python3 -c "
import json, sys
data = json.load(sys.stdin)
filtered = [
  m for m in data
  if m['metaVariables']['single']['VALUE']['text'].startswith((
    '../../core/', '../../shared/', '../../common/'
  ))
]
print(json.dumps(filtered, indent=2))
"
