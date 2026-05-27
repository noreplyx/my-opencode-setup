---
name: ast-grep
description: >-
  Use this skill for ALL structural code search, linting, and rewriting tasks using ast-grep (sg).
  ast-grep is an AST-based tool (tree-sitter) that understands code structure — searches are
  structure-aware, NOT text-based. This skill covers: ad-hoc pattern search (`ast-grep run`),
  YAML rule creation (`ast-grep scan`), code rewriting with `fix` and `transform`, inline rules,
  JSON output, test-driven rule development, project-level scanning, and stdin/pipe usage.
  
  CRITICAL: Use this skill WHENEVER the user asks to "find all X", "search for pattern",
  "replace this code structure", "find functions that...", "refactor X to Y", "lint for...",
  "create a rule", "write a codemod", or ANY codebase structural search/rewrite task — even
  if the user doesn't mention ast-grep by name. Recognize these as ast-grep-worthy tasks.
  ast-grep is ESPECIALLY useful over plain grep when the pattern involves nested code structures,
  multi-line constructs, or semantic relationships between code elements (function calls with
  specific argument patterns, classes with certain decorators, imports from specific modules).
  Also triggers when the user says "find all imports from X", "change all X to Y", or
  "find arrow functions that...". If the task involves any structural understanding of code
  beyond simple keyword matching, load this skill.

---

# ast-grep Skill

ast-grep (`sg`) is a structural code search, lint, and rewrite tool based on Abstract Syntax Trees (tree-sitter). Unlike text-based `grep`, ast-grep understands code structure — it matches AST nodes, not lines.

> **Installed version**: 0.42.3 | **Short alias**: `sg` (e.g. `sg -p 'console.log($ARG)' -l ts`)

## Quick Reference

| Task | Command |
|------|---------|
| Ad-hoc pattern search | `ast-grep -p '$PATTERN' -l <lang>` |
| Ad-hoc search + rewrite | `ast-grep -p '$PATTERN' --rewrite '$NEW' -l <lang>` |
| Interactive rewrite (ask per match) | `ast-grep -p '$PATTERN' --rewrite '$NEW' -l <lang> -i` |
| Apply all rewrites (no prompt) | `ast-grep -p '$PATTERN' --rewrite '$NEW' -l <lang> -U` |
| Scan with YAML rule file | `ast-grep scan --rule rule.yml` |
| Scan with inline rule | `ast-grep scan --inline-rules '...'` |
| Filter results by rule ID | `ast-grep scan --filter 'no-console'` |
| JSON output | `ast-grep -p '$PATTERN' --json` |
| JSON output from stdin | `echo 'code' \| ast-grep --stdin --json -p '$PATTERN' -l <lang>` |
| Debug query parsing | `ast-grep -p '$PATTERN' -l <lang> --debug-query` |
| Test rules (snapshot-based) | `ast-grep test [-U \| -i]` |
| Create rule scaffold | `ast-grep new rule <name>` |
| Create project scaffold | `ast-grep new project <name>` |
| Context lines around match | `ast-grep -p '$PATTERN' -C 3` |
| Follow symlinks | `ast-grep -p '$PATTERN' --follow` |
| Search hidden files / .git | `ast-grep -p '$PATTERN' --no-ignore hidden` |
| Suppress color (CI/scripting) | `ast-grep -p '$PATTERN' --no-color` |
| Strictness control | `ast-grep -p '$PATTERN' --strictness smart` |

---

## How to Think in ast-grep

### Key Insight: AST Matching vs Text Matching

With `grep`, you match text patterns. With `ast-grep`, you write **code patterns** that match syntactically equivalent code:
- Whitespace and line breaks don't matter — `a + b` matches `a+b` and `a + b`
- Comments, strings, and other non-code text are automatically ignored
- Structure is preserved — `foo()` does NOT match `foo(a, b)` because the AST is different
- Rewrite preserves indentation levels

### The Expanded Three-Question Framework

Before writing any ast-grep command, step through this decision tree:

1. **Do I need `pattern` or `kind`?**
   - `pattern` → when you care about the *content* of the code: `console.log($ARG)`
   - `kind` → when you care about the *type* of AST node: all `arrow_function` nodes
   - Combine with `all: [{kind: ...}, {pattern: ...}]` to narrow a node type by content
2. **What parts should be fixed and what parts should be variable?** (use `$META` for variable parts)
3. **Do I need extra conditions?** (only inside classes, only with specific children, etc.)

---

## Chapter 1: Pattern Basics (`ast-grep run`)

### Basic Pattern Matching

```bash
# Find all calls to console.log
ast-grep -p 'console.log($ARG)' -l ts

# Language inferred from file extension
ast-grep -p 'console.log($ARG)' src/
```

**Always single-quote patterns**: `-p '$PATTERN'` ✅ (`-p "$PATTERN"` ❌ — shell expands `$`).

### When `pattern` isn't enough: Pattern Object Syntax

If a pattern is ambiguous, use the object form with `context` and `selector`:

```yaml
rule:
  pattern:
    context: class { $F }
    selector: field_definition
```

### Meta-Variables: The Core Concept

| Meta-Variable | Matches | Example |
|---------------|---------|---------|
| `$NAME` | **Exactly one** AST node | `console.log($ARG)` |
| `$$$NAME` | **Zero or more** AST nodes | `console.log($$$ARGS)` |
| `$_` | Non-capturing single (faster) | `$_.log($_)` |

**Key rule**: `$A` = one node, `$$$A` = 0+. So `console.log($ARG)` matches `log(x)` but NOT `log(x, y)` or `log()`; `console.log($$$)` matches all three.

**Same name = equality**: `$A == $A` matches `a == a` but NOT `a == b`.
**Non-capturing `$_`**: faster — no bookkeeping overhead.

See `references/pattern-syntax.md` for full reference.

### Strictness Control

| Level | Behavior |
|-------|----------|
| `ast` (default) | Match AST, ignore whitespace/semicolons |
| `smart` | Allow extra semicolons, trailing commas |
| `relaxed` | More permissive matching |
| `cst` | Exact match including trivia |
| `signature` | Match function/method signatures only |

### Useful Flags

```bash
ast-grep -p '$PATTERN' -C 3                  # context lines
ast-grep -p '$PATTERN' --no-ignore hidden    # search .git/hidden
ast-grep -p '$PATTERN' -j 4                  # thread count
ast-grep -p '$PATTERN' --globs '*.test.ts'   # file filter
ast-grep -p '$PATTERN' --no-color            # CI/scripting
ast-grep -p '$PATTERN' --json                # structured output for piping
```

---

## Chapter 2: YAML Rules (`ast-grep scan` + `inline-rules`)

### Rule Structure

```yaml
id: descriptive-rule-id           # Required
language: TypeScript              # Required
rule:                             # Required: matching logic
  pattern: console.log($ARG)
```

### Rule Object Fields

A rule matches if ALL fields match (implicit AND). See `references/rule-reference.md` for the complete reference.

| Field | Type | Purpose | Example |
|-------|------|---------|---------|
| `pattern` | String/Object | AST pattern to match | `console.log($ARG)` |
| `kind` | String | Tree-sitter node kind | `call_expression` |
| `regex` | String | Rust regex matching node text | `^[a-z]+$` |
| `nthChild` | Number/String/Object | Position among siblings (1-based) | `3`, `2n+1` |
| `range` | Object | Line/column range | `{start: {line: 0}}` |
| `all` | Array | Must match ALL sub-rules (explicit AND) | `[...]` |
| `any` | Array | Must match ANY sub-rules | `[...]` |
| `not` | Object | Must NOT match sub-rule | `{...}` |
| `matches` | String | Match utility rule by id | `isRouteHandler` |
| `inside` | Object | Must be inside matched node | `{kind: class_declaration}` |
| `has` | Object | Must have descendant matched | `{pattern: await $_}` |
| `precedes` / `follows` | Object | Position relative to sibling | `{kind: function_declaration}` |
| `severity` | String | Report importance | `error`, `warning`, `info`, `hint` |
| `message` | String | Human-readable violation | `"Replace X with Y"` |
| `note` | String | Developer guidance | `"Use the logger module"` |

**`kind` vs `pattern` cheat sheet:**
- `kind` → find node **types**: all `arrow_function`, all `class_declaration` (faster, catches edge cases)
- `pattern` → find specific **content**: `console.log($ARG)`, `import { $$$$$ } from "lodash"`
- Both → `all: [{kind: call_expression}, {pattern: console.log($ARG)}]`

Common kind names: `call_expression`, `function_declaration`, `method_definition`, `arrow_function`, `class_declaration`, `variable_declaration`, `identifier`, `import_statement`, `return_statement`, `binary_expression`. See `references/recipes.md` for per-language lists.

### Complete Rule Examples

**No await in Promise.all:**
```yaml
rule:
  pattern: Promise.all($A)
  has:
    pattern: await $_
    stopBy: end
```

**Functions without return type:**
```yaml
rule:
  kind: function_declaration
  has:
    field: body
    kind: statement_block
  not:
    has:
      field: return_type
```

**Console calls with severity + fix:**
```yaml
id: no-console
language: TypeScript
severity: warning
message: "Replace console.log with logger"
rule:
  any:
    - pattern: console.log($$$)
    - pattern: console.warn($$$)
    - pattern: console.error($$$)
fix: logger.log($$$)
```

**Class methods without `this`:**
```yaml
rule:
  kind: method_definition
  not:
    has:
      pattern: this.$_
```

### Utility Rules

```yaml
utils:
  isRouteHandler:
    any:
      - pattern: app.get($$$)
      - pattern: app.post($$$)
rule:
  matches: isRouteHandler
```

### Running Rules

```bash
ast-grep scan --rule rule.yml                 # single rule file
ast-grep scan --inline-rules 'id:... rule:...' # inline (no file)
ast-grep scan --rule rule1.yml --rule rule2.yml    # multiple files (repeat --rule)
ast-grep scan --filter 'no-console'            # filter by rule ID
ast-grep scan --interactive                    # interactive fix mode
```

---

## Chapter 3: Rewriting Code

### Simple Rewrite: `--rewrite` Flag

```bash
ast-grep -p '$X = $Y' --rewrite '$Y = $X' -l python     # dry-run (shows matches)
ast-grep -p '$X = $Y' --rewrite '$Y = $X' -l python -U  # apply all
ast-grep -p '$X = $Y' --rewrite '$Y = $X' -l python -i  # interactive
```

### YAML Rule Rewrite: `fix` Key

```yaml
id: rename-function
language: Python
rule:
  pattern: |
    def foo($X):
      $$$S
fix: |-
  def bar($X):
    $$$S
---
id: rename-calls
language: Python
rule:
  pattern: foo($X)
fix: bar($X)
```

### Transformations (`transform`)

For string ops on meta-variables before `fix`:

```yaml
rule:
  kind: generator_expression
  pattern: $GEN
transform:
  LIST:
    substring:
      source: $GEN
      startChar: 1
      endChar: -1
fix: '[$LIST]'
```

**Available**: `substring`, `replace` (regex), `convert` (case: camelCase, snake_case, etc.), `rewrite` (recursive). See `references/transforms.md`.

### Constraints (filter meta-variables before transform)

```yaml
constraints:
  OLD_FN:
    regex: ^debug    # only match functions starting with "debug"
    kind: identifier
```

---

## Chapter 4: Project Setup

```bash
ast-grep new project my-rules -y
ast-grep new rule no-console --lang typescript -y
ast-grep new test no-console -y
```

Creates: `sgconfig.yml`, `rules/`, `rule-test/`.

### sgconfig.yml

```yaml
ruleDirs:
  - rules
testConfigs:
  - testDir: rule-test
```

### Tests

```yaml
# rule-test/no-console-test.yml
id: no-console
valid:
  - "logger.log('test')"
invalid:
  - "console.log('test')"
```

```bash
ast-grep test      # run tests
ast-grep test -U   # update snapshots
ast-grep test -i   # interactive review
```

---

## Chapter 5: Advanced Usage

### JSON Output

```bash
ast-grep -p 'import { $$$$$ } from "$MODULE"' --json | jq '.[].metaVariables.single.MODULE.text'
echo 'code' | ast-grep --stdin --json -p 'console.log($$$)' -l ts | jq .
```

JSON from `ast-grep run --json` is a flat array with `text`, `range`, `file`, `replacement`, `metaVariables`.  
**Scan JSON differs**: results are a flat array where each item has a `ruleId` field in addition to `text`, `range`, `file`, `severity`, `note`. Use `ast-grep scan --json` for rule-based findings.

### StdIn Mode

```bash
echo "console.log('test')" | ast-grep --stdin -p 'console.log($ARG)' -l python
```

**StdIn caveats**: requires BOTH `--stdin` AND non-tty piped execution; `--lang` mandatory; `-i` (interactive) incompatible with stdin; `--json` works with stdin.

### Debugging

```bash
ast-grep -p 'console.log($ARG)' -l ts --debug-query
```

Use the [ast-grep playground](https://ast-grep.github.io/playground.html) to discover kind names and test patterns.

### Language Reference

| Language | `--lang` | Extensions |
|----------|----------|-----------|
| JavaScript | `js` / `javascript` | `.js`, `.jsx`, `.mjs` |
| TypeScript | `ts` / `typescript` | `.ts`, `.tsx`, `.mts` |
| Python | `py` / `python` | `.py` |
| Rust | `rs` / `rust` | `.rs` |
| Go | `go` / `golang` | `.go` |
| Java | `java` | `.java` |
| HTML | `html` | `.html` |
| CSS | `css` | `.css` |

---

## Decision Flow: Which Approach to Use

| You need to... | Use this |
|----------------|----------|
| Simple text search (one keyword) | `grep`/`ripgrep` — ast-grep is overkill |
| Structural search (by syntax, not text) | `ast-grep run -p '...'` |
| Complex search (multiple conditions, relational rules) | YAML rule → `ast-grep scan --inline-rules` |
| Code refactoring / codemod (transform code) | YAML `fix`/`transform` → `ast-grep scan --rule rule.yml -U` |
| Persistent lint rule (run in CI) | Project setup → `ast-grep new project`, add rules |
| Piped/scripted usage (process stdin) | `ast-grep --stdin` or `--json` |
| Rule development (discover kinds, test) | [Playground](https://ast-grep.github.io/playground.html) first, then `ast-grep test` |

---

## Important Gotchas

### Quoting & Shell (top priority — most common bug)
- **Always single-quote patterns**: `-p '$PATTERN'` ✅ — `-p "$PATTERN"` ❌ (shell expands `$`)
- **Pattern must be valid code** in the target language — tree-sitter must parse it

### Meta-Variables
- **One `$NAME` = one AST node**: `$A` won't match `a, b` — use `$$$` for multiple
- **`$_` is non-capturing**: faster — no bookkeeping overhead
- **`transform` vars don't use `$`**: `NEW_VAR`, not `$NEW_VAR`
- **Same-name capture = equality**: `$A == $A` matches `a == a`, not `a == b`

### Rules & Matching
- **`pattern` ≠ `kind`**: `pattern` matches specific code; `kind` matches node types. Use `kind` for "find ALL arrow functions", `pattern` for "find arrow functions that call foo()". Combine with `all:`.
- **`kind` names are language-specific**: use the [playground](https://ast-grep.github.io/playground.html) to discover them
- **`nthChild` is 1-based** (like CSS)
- **Regex uses Rust syntax** — no lookahead/lookbehind/backreferences

### Rewriting
- **`fix` is indentation-sensitive**: meta-variables preserve their original indentation
- **`-U` applies rewrites**: without it, `ast-grep run --rewrite` is a dry-run
- **`-i` confirms each replacement**: interactive mode

### Stdin & Piping
- **`--stdin` requires BOTH flag AND non-tty execution**: can't type input interactively
- **`--lang` mandatory with stdin**: no file extension to infer
- **`scan` + stdin**: only one rule via `--rule` (not `--inline-rules`)
- **`--json` works with `--stdin`**: pipe-friendly structured output
- **`-i` incompatible with `--stdin`**: stdin is already consumed

### Output Control
- **`--no-color`**: suppresses ANSI for CI/scripting
- **`severity`**: `error` > `warning` > `info` > `hint` — controls scan output visibility
- **Scan JSON ≠ Run JSON**: `ast-grep scan --json` gives flat array with `ruleId` field; `ast-grep run --json` gives flat array without `ruleId`
- **`--no-ignore hidden`**: search `.git` and hidden files

---

## Reference Files

- `references/rule-reference.md` — Full rule object reference, atomic/composite/relational rules, TypeScript interfaces, complete YAML structure
- `references/pattern-syntax.md` — Meta-variable syntax, pattern object forms, strictness levels
- `references/transforms.md` — Transform operations (replace, substring, convert, rewrite), chaining
- `references/recipes.md` — Common patterns for TS/JS, Python, Rust; multi-step codemods; kind name tables by language

---

## Agent Tool Protocol

### Purpose
ast-grep (sg) is an **on-demand structural code tool** for subagents — NOT a pipeline gate. The rules it enforces (no-console, missing return types, no-any-type, etc.) are already covered by ESLint, TypeScript strict mode, and the semgrep SAST scan. Its real value is in **structural search, discovery, and codemod/rewrite operations** that text-based grep cannot perform.

### When Subagents Should Use ast-grep

| Agent | Typical Task | ast-grep Role |
|-------|-------------|---------------|
| **Finder** | Codebase exploration | Structural pattern discovery: "Find all classes that implement interface X", "Find all function declarations with specific decorators" |
| **PlanDescriber** | Pattern analysis before planning | "Find all service/repository patterns to understand conventions" — AST-aware search reveals structural consistency |
| **Implementor** | Writing new code | "Find existing patterns to follow", "Rename function X to Y across all call sites" (codemod) |
| **Fixer** | Debugging & fixing | "Find all try/catch blocks without error logging", "Find all places where deprecated API is called" |
| **QA** | Test verification | "Find all test files that use pattern P" |

### When NOT to Use ast-grep

- **Simple keyword search** → use grep/
g (ast-grep is overkill for text matching)
- **Already enforced by the Lint Gate** → ESLint already catches 
o-console, 
o-explicit-any, explicit-function-return-type, 
o-empty
- **Already covered by semgrep SAST** → semgrep already catches AST-level security patterns
- **Already covered by TypeScript strict mode** → strict, 
oImplicitReturns, strictNullChecks

### Quick Commands for Subagents

| Task | Command |
|------|---------|
| Find all function calls matching a pattern | sg -p 'console.log()' -l ts |
| Find all arrow functions | sg -p 'ARG => ' -l ts |
| Find imports from a specific module | sg -p 'import { $$$ } from "lodash"' -l ts |
| Refactor: rename function across all files | sg -p 'oldName($$$)' --rewrite 'newName($$$)' -l ts -U |
| Find empty catch blocks | sg scan --inline-rules "id: ec language: ts rule: {kind: catch_clause has: {pattern: {}}}" |
| Find classes with specific decorators | sg -p '@Injectable() class  { $ }' -l ts |

### Loading the Skill

Subagents load this skill explicitly when they need to perform structural code analysis:

`
skill("ast-grep")
`

The Orchestrator does NOT auto-load this skill during pipeline execution. It is triggered by subagent task requirements.

### Full Reference

See the sections above for complete coverage of:
- Pattern basics (st-grep run)
- YAML rules (st-grep scan)
- Rewriting code with ix and 	ransform
- JSON output and stdin piping
- Debugging and project setup
- All language-kind tables and recipe patterns
