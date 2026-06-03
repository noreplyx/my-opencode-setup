# ast-grep Pattern Syntax Reference

## Core Concept

ast-grep patterns are code snippets that ast-grep parses into AST nodes. The pattern matches target code that has the **same syntactical structure** -- whitespace, comments, and formatting are irrelevant.

## Meta-Variables

Meta-variables are placeholders in patterns that match AST nodes.

### Single Meta-Variable: `$NAME`

Matches exactly **one** AST node.

| Variable | Description |
|----------|-------------|
| `$ANYTHING` | Captures a named AST node |
| `$_` | Non-capturing -- suppresses variable tracking for speed |
| `$_ANYTHING` | Non-capturing named -- also suppresses tracking |
| `$_123` | Valid (digits allowed with underscore) |

**Valid names**: `$META`, `$META_VAR`, `$META_VAR1`, `$_`, `$_123`, `$$`
**Invalid names**: `$invalid` (lowercase), `$Svalue` (no lowercase after `$`), `$123` (starts with digit), `$KEBAB-CASE` (hyphen), `$` (too short)

### Multi Meta-Variable: `$$$NAME`

Matches **zero or more** AST nodes. Used for:
- Function arguments: `foo($$$)` matches `foo()`, `foo(a)`, `foo(a, b, c)`
- Function parameters: `function $F($$$P) { $$$ }`
- Statements in blocks: `{ $$$ }`
- Array elements: `[$A, $$$REST]`

### Capturing with Same Name

Reusing the same meta-variable name enforces equality:

```javascript
// Pattern: $A == $A
a == a              // [x] matches
1 + 1 == 1 + 1      // [x] matches (same subtree)
a == b              // [X] no match
1 + 1 == 2          // [X] no match (different subtrees)
```

### Non-Capturing with `$_`

All meta-variables starting with `$_` suppress capture tracking:

```javascript
// Pattern: $_FUNC($_)
test(a)             // [x] no capture bookkeeping
foo(x)              // [x]
```

This is faster because ast-grep doesn't create a HashMap for bookkeeping.

## Pattern Object Syntax

When a pattern string doesn't parse correctly or needs context, use the object form:

```yaml
pattern:
  context: class { $F }
  selector: field_definition
```

The `context` provides a valid parse context, and `selector` extracts the relevant part.

## Strictness Levels

Control matching strictness:

| Level | Description |
|-------|-------------|
| `ast` (default) | Match AST structure, ignore whitespace, comments, semicolons |
| `cst` | Exact match including trivia (comments, whitespace) |
| `smart` | Allow minor syntactic differences (extra semicolons, trailing commas) |
| `relaxed` | More permissive matching |
| `signature` | Match function/method signatures only (names and parameters) |
