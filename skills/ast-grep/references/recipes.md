# ast-grep Common Recipes

## JavaScript / TypeScript

### 1. Find all `console.*` calls

```bash
ast-grep -p 'console.log($$$)' -l ts
ast-grep -p 'console.warn($$$)' -l ts
```

Or as a rule:
```yaml
id: no-console
language: TypeScript
severity: warning
message: "Replace console.* with logger"
rule:
  any:
    - pattern: console.log($$$)
    - pattern: console.warn($$$)
    - pattern: console.error($$$)
    - pattern: console.info($$$)
fix: logger.log($$$)
```

### 2. Find unused catch binding

```yaml
id: no-unused-catch-param
language: TypeScript
rule:
  pattern: catch($ERR) { $$$ }
  not:
    has:
      pattern: $ERR
```

### 3. Convert `forEach` to `for...of` (when index not used)

```yaml
id: forEach-to-for-of
language: TypeScript
rule:
  pattern: $ARR.forEach(($ITEM) => { $$$ })
fix: for (const $ITEM of $ARR) { $$$ }
```

### 4. Find optional chaining candidates

```yaml
id: optional-chaining
language: TypeScript
rule:
  pattern: $A && $A()
fix: $A?.()
```

### 5. Find imports from specific module with JSON output

```bash
ast-grep -p 'import { $$$ } from "$MODULE"' -l ts --json | jq '.[].metaVariables.single.MODULE.text'
```

### 6. Find all async functions

```yaml
id: async-funcs
language: TypeScript
rule:
  pattern: async function $NAME($$$) { $$$ }
```

### 7. Find type exports

```yaml
id: type-exports
language: TypeScript
rule:
  pattern: export type $NAME = $TYPE
```

### 8. Stdin + JSON for pipe workflows

```bash
# Find imports from piped content, output JSON
cat somefile.ts | ast-grep --stdin --json -p 'import { $$$ } from "$PATH"' -l ts

# Chain with jq to extract just the module paths
cat somefile.ts | ast-grep --stdin --json -p 'import { $$$ } from "$PATH"' -l ts | jq '[.[].metaVariables.single.PATH.text]'
```

## Python

### 1. Find print statements

```bash
ast-grep -p 'print($$$)' -l py
```

### 2. Find mutable default arguments

```yaml
id: mutable-default
language: Python
rule:
  pattern: def $F($$$, $ARG=[], $$$)
```

### 3. Convert generator to list comprehension in join

```yaml
id: convert-generator
language: Python
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

## Rust

### 1. Find unwrap calls

```bash
ast-grep -p 'unwrap()' -l rs
```

### 2. Find clone calls

```bash
ast-grep -p '.clone()' -l rs
```

### 3. Find functions returning Result

```yaml
id: result-return
language: Rust
rule:
  kind: function_item
  has:
    pattern: Result<$_, $_>
```

## Multi-Step Codemod Pattern

For complex refactors, chain multiple rules in one YAML file (separated by `---`):

```yaml
# Step 1: Rename function
id: rename-func
language: TypeScript
rule:
  pattern: function oldFunc($$$ARGS): $$$RET { $$$BODY }
fix: function newFunc($$$ARGS): $$$RET { $$$BODY }
---
# Step 2: Rename calls
id: rename-calls
language: TypeScript
rule:
  pattern: oldFunc($$$)
fix: newFunc($$$)
---
# Step 3: Rename references in type annotations
id: rename-types
language: TypeScript
rule:
  pattern: OldType
  inside:
    any:
      - kind: type_annotation
      - kind: type_alias_declaration
fix: NewType
```

Run with: `ast-grep scan --rule codemod.yml -U src/`

## Common Kind Names by Language

### TypeScript/JavaScript
| Kind | Matches |
|------|---------|
| `call_expression` | `foo()` |
| `function_declaration` | `function foo() {}` |
| `arrow_function` | `() => {}` |
| `method_definition` | `{ foo() {} }` |
| `class_declaration` | `class Foo {}` |
| `variable_declaration` | `const x = ...` |
| `binary_expression` | `a + b`, `a === b` |
| `member_expression` | `a.b` |
| `identifier` | variable names |
| `property_identifier` | property names |
| `string` / `number` | string/number literals |
| `if_statement` / `for_statement` / `while_statement` | control flow |
| `return_statement` | `return x` |
| `import_statement` | `import ...` |
| `export_statement` | `export ...` |
| `template_string` | `` `hello ${x}` `` |
| `ternary_expression` | `a ? b : c` |
| `assignment_expression` | `x = y` |

### Python
| Kind | Matches |
|------|---------|
| `call` | `foo()` |
| `function_definition` | `def foo():` |
| `class_definition` | `class Foo:` |
| `assignment` | `x = y` |
| `for_statement` | `for x in list:` |
| `if_statement` | `if condition:` |
| `return_statement` | `return x` |
| `import_statement` | `import foo` |
| `import_from_statement` | `from foo import bar` |
| `list_comprehension` | `[x for x in list]` |
| `lambda` | `lambda x: x + 1` |
| `decorated_definition` | `@decorator\ndef foo():` |
| `string` / `integer` / `float` | literals |
| `identifier` | names |
| `attribute` | `obj.attr` |

### Rust
| Kind | Matches |
|------|---------|
| `function_item` | `fn foo()` |
| `call_expression` | `foo()` |
| `struct_item` | `struct Foo {}` |
| `impl_item` | `impl Foo {}` |
| `let_declaration` | `let x = ...` |
| `match_expression` | `match x { ... }` |
| `if_expression` | `if condition { ... }` |
| `macro_invocation` | `println!()` |
| `method_call_expression` | `obj.method()` |
| `generic_type` | `Vec<u32>` |
