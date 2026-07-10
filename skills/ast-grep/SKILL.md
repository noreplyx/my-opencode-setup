---
name: ast-grep
description: >-
  Use this skill for structural code search and codemod/rewrite operations using ast-grep.
  ast-grep is an AST-based tool (tree-sitter) that understands code structure -- searches are
  structure-aware, NOT text-based. This skill covers: ad-hoc pattern search (`ast-grep run`),
  code rewriting with `--rewrite`/`fix`/`transform`, YAML rule creation (`ast-grep scan`),
  inline rules, JSON output, stdin/pipe usage, and project-level scanning.
  
  CRITICAL: Use this skill WHENEVER the user asks to "find all X", "search for pattern",
  "replace this code structure", "find functions that...", "refactor X to Y",
  "write a codemod", or ANY codebase structural search/rewrite task -- even
  if the user doesn't mention ast-grep by name. Recognize these as ast-grep-worthy tasks.
  ast-grep is ESPECIALLY useful over plain grep when the pattern involves nested code structures,
  multi-line constructs, or semantic relationships between code elements (function calls with
  specific argument patterns, classes with certain decorators, imports from specific modules).
  Also triggers when the user says "find all imports from X", "change all X to Y", or
  "find arrow functions that...". If the task involves any structural understanding of code
  beyond simple keyword matching, load this skill.

---

# ast-grep Skill

ast-grep is a structural code search and rewrite tool based on Abstract Syntax Trees (tree-sitter). Unlike text-based `grep`, ast-grep understands code structure -- it matches AST nodes, not lines.

> **Installed version**: 0.44.1 | **Short alias**: `sg` (e.g. `sg -p 'console.log($ARG)' -l ts`)

## Quick Reference

| Task | Command |
|------|---------|
| Ad-hoc pattern search | `ast-grep -p '$PATTERN' -l <lang>` |
| Context lines around match | `ast-grep -p '$PATTERN' -C 3` |
| JSON output | `ast-grep -p '$PATTERN' --json` |
| Search hidden files / .git | `ast-grep -p '$PATTERN' --no-ignore hidden` |
| Sort results by file/line | `ast-grep -p '$PATTERN' --sort` |
| Deduplicate identical matches | `ast-grep -p '$PATTERN' --unique` |
| Limit number of matches | `ast-grep -p '$PATTERN' --max-match-count 10` |
| Ad-hoc search + rewrite (dry-run) | `ast-grep -p '$PATTERN' --rewrite '$NEW' -l <lang>` |
| Apply all rewrites (no prompt) | `ast-grep -p '$PATTERN' --rewrite '$NEW' -l <lang> -U` |
| Interactive rewrite (ask per match) | `ast-grep -p '$PATTERN' --rewrite '$NEW' -l <lang> -i` |
| Scan with YAML rule file | `ast-grep scan --rule rule.yml` |
| Scan with inline rule | `ast-grep scan --inline-rules '...'` |
| Filter results by rule ID | `ast-grep scan --filter 'no-console'` |
| JSON output from stdin | `echo 'code' \| ast-grep --stdin --json -p '$PATTERN' -l <lang>` |
| Debug query parsing | `ast-grep -p '$PATTERN' -l <lang> --debug-query` |
| Test rules (snapshot-based) | `ast-grep test [-U \| -i]` |
| Create rule scaffold | `ast-grep new rule <name>` |
| Create project scaffold | `ast-grep new project <name>` |
| Follow symlinks | `ast-grep -p '$PATTERN' --follow` |
| Suppress color (CI/scripting) | `ast-grep -p '$PATTERN' --no-color` |
| Strictness control | `ast-grep -p '$PATTERN' --strictness smart` |
| Scan JSON output | `ast-grep scan --rule rule.yml --json` |

---

## How to Think in ast-grep

### Key Insight: AST Matching vs Text Matching

With `grep`, you match text patterns. With `ast-grep`, you write **code patterns** that match syntactically equivalent code:
- Whitespace and line breaks don't matter -- `a + b` matches `a+b` and `a + b`
- Comments, strings, and other non-code text are automatically ignored
- Structure is preserved -- `foo()` does NOT match `foo(a, b)` because the AST is different
- Rewrite preserves indentation levels

---

## Chapter 1: Pattern Basics (`ast-grep run`)

### Basic Pattern Matching

```bash
# Find all calls to console.log
ast-grep -p 'console.log($ARG)' -l ts

# Language inferred from file extension
ast-grep -p 'console.log($ARG)' src/
```

**Always single-quote patterns**: `-p '$PATTERN'` [x] (`-p "$PATTERN"` [X] -- shell expands `$`).

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

**Key rule**: `$A` = one node, `$$$A` = 0+. So `console.log($ARG)` matches `log(x)` but NOT `log(x, y)` or `log()`; `console.log($$$ARGS)` matches all three.

**Same name = equality**: `$A == $A` matches `a == a` but NOT `a == b`.
**Non-capturing `$_`**: faster -- no bookkeeping overhead.

See `references/pattern-syntax.md` for full reference.

### Strictness Control

| Level | Behavior |
|-------|----------|
| `ast` (default) | Match AST, ignore whitespace/semicolons |
| `smart` | Allow extra semicolons, trailing commas |
| `relaxed` | More permissive matching |
| `cst` | Exact match including trivia |
| `signature` | Match function/method signatures only |
| `template` | Match text only, node kinds are ignored |

### Performance Tips

- **`kind` is faster than `pattern`**: matching by node type avoids parsing overhead. Use `kind: call_expression` instead of `pattern: $_.call()` when you don't need to match specific content.
- **`$_` is faster than `$NAME`**: non-capturing meta-variables skip bookkeeping. Use `$_` when you don't need the captured value.
- **`--max-match-count N`**: stop scanning after N matches to bound runtime.
- **`-j N`**: control thread count (default: number of CPU cores).

### Useful Flags

```bash
ast-grep -p '$PATTERN' -C 3                  # context lines
ast-grep -p '$PATTERN' --no-ignore hidden    # search .git/hidden
ast-grep -p '$PATTERN' -j 4                  # thread count
ast-grep -p '$PATTERN' --globs '*.test.ts'    # file filter
ast-grep -p '$PATTERN' --no-color            # CI/scripting
ast-grep -p '$PATTERN' --json                # structured output for piping
```

---

## Chapter 2: Rewriting Code

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

**Apply with**: `ast-grep scan --rule rule.yml -U` (without `-U`, it's a dry-run).

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

## Chapter 3: YAML Rules (`ast-grep scan` + `inline-rules`)

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
- `kind` -> find node **types**: all `arrow_function`, all `class_declaration` (faster, catches edge cases)
- `pattern` -> find specific **content**: `console.log($ARG)`, `import { $$$ } from "lodash"`
- Both -> `all: [{kind: call_expression}, {pattern: console.log($ARG)}]`

Common kind names: `call_expression`, `function_declaration`, `method_definition`, `arrow_function`, `class_declaration`, `variable_declaration`, `identifier`, `import_statement`, `return_statement`, `binary_expression`. See `references/recipes.md` for per-language lists.

### Complete Rule Examples

**Find classes with a specific decorator:**
```yaml
rule:
  pattern: '@Injectable() class $NAME { $$$BODY }'
```

**Find imports from a specific module:**
```yaml
rule:
  pattern: import { $$$ } from "lodash"
```

**Find functions matching a signature pattern:**
```yaml
rule:
  kind: function_declaration
  has:
    pattern: find$_
  has:
    field: return_type
    pattern: Promise<$T>
```

**No await in Promise.all:**
```yaml
rule:
  pattern: Promise.all($A)
  has:
    pattern: await $_
    stopBy: end
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
ast-grep -p 'import { $$$ } from "$MODULE"' --json | jq '.[].metaVariables.single.MODULE.text'
echo 'code' | ast-grep --stdin --json -p 'console.log($$$)' -l ts | jq .
```

JSON from `ast-grep run --json` is a flat array with `text`, `range`, `file`, `replacement`, `metaVariables`.  
**Scan JSON differs**: results are a flat array where each item has a `ruleId` field in addition to `text`, `range`, `file`, `severity`, `note`. Use `ast-grep scan --json` for rule-based findings.

### StdIn Mode

```bash
echo "console.log('test')" | ast-grep --stdin -p 'console.log($ARG)' -l ts
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
| Structural search (by syntax, not text) | `ast-grep run -p '...'` |
| Code refactoring / codemod (transform code) | YAML `fix`/`transform` -> `ast-grep scan --rule rule.yml -U` |
| Complex search (multiple conditions, relational rules) | YAML rule -> `ast-grep scan --inline-rules` |
| Simple text search (one keyword) | `grep`/`ripgrep` -- ast-grep is overkill |
| Persistent lint rule (run in CI) | Project setup -> `ast-grep new project`, add rules |
| Piped/scripted usage (process stdin) | `ast-grep --stdin` or `--json` |
| Rule development (discover kinds, test) | [Playground](https://ast-grep.github.io/playground.html) first, then `ast-grep test` |

---

## Important Gotchas

### Quoting & Shell (top priority -- most common bug)
- **Always single-quote patterns**: `-p '$PATTERN'` [x] -- `-p "$PATTERN"` [X] (shell expands `$`)
- **Pattern must be valid code** in the target language -- tree-sitter must parse it

### Meta-Variables
- **One `$NAME` = one AST node**: `$A` won't match `a, b` -- use `$$$` for multiple
- **`$_` is non-capturing**: faster -- no bookkeeping overhead
- **`transform` vars don't use `$`**: `NEW_VAR`, not `$NEW_VAR`
- **Same-name capture = equality**: `$A == $A` matches `a == a`, not `a == b`

### Rules & Matching
- **`pattern` vs `kind`**: `pattern` matches specific code; `kind` matches node types. Use `kind` for "find ALL arrow functions", `pattern` for "find arrow functions that call foo()". Combine with `all:`.
- **`kind` names are language-specific**: use the [playground](https://ast-grep.github.io/playground.html) to discover them
- **`nthChild` is 1-based** (like CSS)
- **Regex uses Rust syntax** -- no lookahead/lookbehind/backreferences

### Rewriting
- **`fix` is indentation-sensitive**: meta-variables preserve their original indentation
- **`-U` applies rewrites**: without it, `ast-grep run --rewrite` is a dry-run
- **`-i` confirms each replacement**: interactive mode
- **Multi-rule ordering matters**: when chaining rules in one YAML file (separated by `---`), rules are applied in order. Each rule sees the output of the previous one. For example, rename the function definition first, then rename its call sites.

### Stdin & Piping
- **`--stdin` requires BOTH flag AND non-tty execution**: can't type input interactively
- **`--lang` mandatory with stdin**: no file extension to infer
- **`scan` + stdin**: only one rule via `--rule` (not `--inline-rules`)
- **`--json` works with `--stdin`**: pipe-friendly structured output
- **`-i` incompatible with `--stdin`**: stdin is already consumed

### Output Control
- **`--no-color`**: suppresses ANSI for CI/scripting
- **`severity`**: `error` > `warning` > `info` > `hint` -- controls scan output visibility
- **Scan JSON vs Run JSON**: `ast-grep scan --json` gives flat array with `ruleId` field; `ast-grep run --json` gives flat array without `ruleId`
- **`--no-ignore` requires a sub-option**: e.g., `--no-ignore hidden` (search dotfiles), `--no-ignore vcs` (ignore .gitignore). See `ast-grep run --help` for all values.

---

## Reference Files

- `references/rule-reference.md` -- Full rule object reference, atomic/composite/relational rules, TypeScript interfaces, complete YAML structure
- `references/pattern-syntax.md` -- Meta-variable syntax, pattern object forms, strictness levels
- `references/transforms.md` -- Transform operations (replace, substring, convert, rewrite), chaining
- `references/recipes.md` -- Common patterns for TS/JS, Python, Rust; multi-step codemods; kind name tables by language

---

## Subagent Usage

ast-grep is an **on-demand structural code tool** for subagents -- NOT a pipeline gate. Use it for structural search, discovery, and codemod/rewrite operations that text-based grep cannot perform.

| Agent | Typical Task | ast-grep Command |
|-------|-------------|------------------|
| **code-explorer** | Find all classes implementing an interface | `sg -p 'class $NAME implements $IFACE { $$$ }' -l ts` |
| **code-explorer** | Find all function declarations with a decorator | `sg -p '@$DECORATOR\ndef $NAME($$$):' -l py` |
| **Implementor** | Rename a function across all call sites | `sg -p 'oldName($$$)' --rewrite 'newName($$$)' -l ts -U` |
| **Implementor** | Discover existing patterns before writing code | `sg -p 'repository.$METHOD($$$)' -l ts` |
| **Fixer** | Find try/catch blocks without error logging | `sg scan --inline-rules "id: ec language: ts rule: {kind: catch_clause has: {pattern: '{}'}}"` |
| **Fixer** | Find deprecated API calls | `sg -p 'deprecatedApi($$$)' -l ts` |
| **QA** | Find all test files using a specific pattern | `sg -p 'describe("$NAME", $$$)' --globs '*.test.ts'` |

**When NOT to use**: simple keyword search (use grep/rg), lint rules already enforced by ESLint, security patterns already covered by semgrep SAST, or TypeScript strict mode checks.
