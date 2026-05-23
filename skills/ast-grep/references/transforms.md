# Transform Operations Reference

Transform operations modify meta-variable content before using it in `fix`.

## Syntax

Single-line (ast-grep 0.38.3+):
```yaml
transform:
  NEW_VAR: replace($OLD, ...)
  ANOTHER: substring($NEW_VAR, startChar=1, endChar=-1)
```

Object form:
```yaml
transform:
  NEW_VAR:
    replace:
      source: $OLD
      replace: regex
      by: replacement
```

**Note**: New variable names do NOT start with `$`. They are plain identifiers like `NEW_VAR`.

## Available Transforms

### 1. `replace`

Use a Rust regex to search and replace text in a meta-variable.

```yaml
transform:
  NEW_VAR:
    replace:
      source: $META_VAR    # source meta-variable (with $)
      replace: regex       # Rust regex pattern
      by: replacement      # replacement string (can reference capture groups)
```

**Regex capture group reference**: Use named groups `(?<NAME>...)` and reference with `$NAME`:

```yaml
transform:
  NEW_FN:
    replace:
      source: $OLD_FN
      replace: debug(?<REG>.*)
      by: release$REG
```

### 2. `substring`

Extract a substring by character indices.

```yaml
transform:
  NEW_VAR:
    substring:
      source: $META_VAR
      startChar: 1         # first character index (0-based, negative counts from end)
      endChar: -1          # one past last character (negative counts from end)
```

Common use case: strip parentheses from a generator expression:
```yaml
transform:
  LIST:
    substring:
      source: $GEN
      startChar: 1
      endChar: -1
```

### 3. `convert`

Change the case convention of a meta-variable.

```yaml
transform:
  NEW_VAR:
    convert:
      source: $META_VAR
      toCase: snakeCase    # camelCase | snake_case | PascalCase | SCREAMING_SNAKE_CASE | kebab-case
```

### 4. `rewrite`

Apply ast-grep rules recursively to a meta-variable's content.

```yaml
transform:
  NEW_VAR:
    rewrite:
      source: $META_VAR
      rules:               # list of rewrite rules
        - id: inner-rule
          rule:
            pattern: old
          fix: new
```

## Chaining

Transformations are applied in order. Later transforms can reference variables created by earlier ones:

```yaml
transform:
  STEP1:
    substring:
      source: $ORIG
      startChar: 2
  FINAL:
    convert:
      source: $STEP1
      toCase: camelCase
```

## Full Example

```yaml
id: transform-example
language: TypeScript
rule:
  pattern: const $NAME = $VALUE
transform:
  CONST_NAME:
    convert:
      source: $NAME
      toCase: SCREAMING_SNAKE_CASE
fix: const $CONST_NAME = $VALUE
```
