# Eval 5: JSON Import Search — ast-grep (with skill)

# Command 1: Search for all imports with meta-variables
ast-grep -p 'import { $$$ } from "$PATH"' -l ts --json search-sample.ts

# Command 2: With jq filtering for specific paths
ast-grep -p 'import { $$$ } from "$PATH"' -l ts --json search-sample.ts | \
  jq '.[] | select(.metaVariables.single.PATH.text | test(
    "^\"\\.\\.\\/\\.\\.\\/(core|shared|common)\"$"
  ))'

# Command 3: Using YAML inline rule with 'any' for precise matching
ast-grep scan --inline-rules '
id: find-rel-imports
language: TypeScript
rule:
  any:
    - pattern: import { $$$ } from "../../core"
    - pattern: import { $$$ } from "../../shared"
    - pattern: import { $$$ } from "../../common"
' --json search-sample.ts

# Result: [] (empty — search-sample.ts only has @angular/* imports, not ../../*)
