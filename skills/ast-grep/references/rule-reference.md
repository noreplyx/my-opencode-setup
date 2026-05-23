# ast-grep Rule Object Reference

This document provides the complete reference for ast-grep's rule object system.

## Table of Contents

1. [Atomic Rules](#atomic-rules)
2. [Composite Rules](#composite-rules)
3. [Relational Rules](#relational-rules)
4. [Full Rule Object Reference](#full-rule-object-reference)

## Atomic Rules

Atomic rules are the simplest rules — they match nodes based on intrinsic properties.

### `pattern`

- **Type**: `String | Object`
- **Description**: Match an AST node by code pattern

**String form**: Write code as a string; ast-grep parses it into an AST and matches structurally equivalent nodes.

```yaml
pattern: console.log($ARG)
```

**Object form**: Use when the pattern needs context to parse correctly (e.g., class body fields, statement in a block).

```yaml
pattern:
  context: class { $F }
  selector: field_definition
  strictness: smart   # optional: cst | smart | ast | relaxed | signature
```

### `kind`

- **Type**: `String`
- **Description**: Match a node by its tree-sitter AST kind name

Kind names depend on the language. Use the playground to discover them.

```yaml
kind: call_expression
```

Also supports limited ESQuery selector syntax:
```yaml
kind: call_expression > identifier   # identifier that is direct child of call_expression
```

### `regex`

- **Type**: `String`
- **Description**: Match node text against a Rust regex. The regex must match the **entire** text of the node.

```yaml
regex: ^[a-z_][a-zA-Z0-9_]+$
regex: console
regex: (?i)hello(?-i)world    # case-sensitive toggle
```

Note: Rust regex does NOT support lookahead, lookbehind, or backreferences.

### `nthChild`

- **Type**: `Number | String | Object`
- **Description**: Match node by its position among siblings (1-based)

```yaml
# Number: exact position
nthChild: 3

# String: An+B formula
nthChild: 2n+1     # odd positions
nthChild: 2n       # even positions
nthChild: n+3      # position 3 and beyond

# Object: full control
nthChild:
  position: 1              # or "2n+1"
  reverse: true            # count from end
  ofRule:                  # filter siblings
    kind: function_declaration
```

Note: Only named nodes are counted, not unnamed nodes (punctuation like `,`, `;`, `(`, `)`).

### `range`

- **Type**: `Object`
- **Description**: Match node by source position (0-based, character-based)

```yaml
range:
  start:
    line: 0
    column: 0
  end:
    line: 0
    column: 3
```

This matches a node starting at position (0,0) and ending at (0,3), e.g., `foo` in `foo.bar()`.

### `severity`

- **Type**: `String`
- **Description**: Controls how the rule's findings are reported in scan output

```yaml
severity: error      # error | warning | info | hint
```

Used in scan mode to color-code and filter results. `error` findings typically exit non-zero, while `info`/`hint` are advisory.

## Composite Rules

Composite rules combine multiple sub-rules using logical operators.

### `all`

- **Type**: `Array<Rule>`
- **Description**: A node matches if ALL sub-rules match. Meta-variables are merged from all matches.

```yaml
all:
  - kind: call_expression
  - pattern: console.log($ARG)
```

The order of sub-rules in `all` can affect evaluation — use `all` over implicit AND when order matters.

### `any`

- **Type**: `Array<Rule>`
- **Description**: A node matches if ANY sub-rule matches. Meta-variables only come from the matched sub-rule.

```yaml
any:
  - pattern: console.log($ARG)
  - pattern: console.warn($ARG)
  - pattern: console.error($ARG)
```

### `not`

- **Type**: `Rule`
- **Description**: A node matches if the sub-rule does NOT match.

```yaml
not:
  pattern: console.log($ARG)
```

### `matches`

- **Type**: `String`
- **Description**: A node matches if the named utility rule matches.

Utility rules are defined under the `utils` key:

```yaml
utils:
  isReactComponent:
    any:
      - pattern: "function $NAME($$$): JSX.Element"
      - kind: arrow_function
rule:
  matches: isReactComponent
```

## Relational Rules

Relational rules match nodes based on their position relative to other nodes.

All relational rules accept a sub-rule plus these optional fields:

### `inside`

- **Type**: `Object`
- **Description**: The target node must be **inside** a node matching the sub-rule.

```yaml
inside:
  pattern: class $TEST { $$$ }
  stopBy: end          # default: neighbor
  field: body          # restrict to a named child field
```

### `has`

- **Type**: `Object`
- **Description**: The target node must **have a descendant** matching the sub-rule.

```yaml
has:
  kind: property_identifier
  stopBy: end          # default: neighbor
  field: name          # restrict to a named child field
```

### `precedes`

- **Type**: `Object`
- **Description**: The target node must appear **before** a node matching the sub-rule.

```yaml
precedes:
  kind: function_declaration
  stopBy: end
```

### `follows`

- **Type**: `Object`
- **Description**: The target node must appear **after** a node matching the sub-rule.

```yaml
follows:
  kind: function_declaration
  stopBy: end
```

### `stopBy`

Controls how far to search when looking for relational matches.

| Value | Behavior |
|-------|----------|
| `neighbor` (default) | Stop at immediate parent (inside), immediate child (has), or adjacent sibling (precedes/follows) |
| `end` | Search all the way — to root for `inside`, to leaf for `has`, to first/last sibling for `precedes`/`follows` |
| `Rule` object | Stop when the surrounding node matches this rule (inclusive — if the matched node also satisfies the relational rule, the target still matches) |

### `field`

- **Available in**: `inside`, `has`
- **Type**: `String`

Restricts the relational match to a specific named child field of the target node. This is a tree-sitter concept — nodes have named children like `body`, `condition`, `name`, `value`, `arguments`, `parameters`, etc.

Example — match only `return` inside the function body (not in nested arrow functions):
```yaml
rule:
  kind: return_statement
  inside:
    kind: function_declaration
    stopBy: end
    field: body
```

## Full Rule Object Reference

Here's the complete TypeScript interface for the rule object:

```typescript
interface RuleObject {
  // Atomic
  pattern?: string | Pattern
  kind?: string
  regex?: string
  nthChild?: number | string | NthChildConfig
  range?: RangeConfig

  // Composite
  all?: RuleObject[]
  any?: RuleObject[]
  not?: RuleObject
  matches?: string

  // Relational
  inside?: RuleObject & Relation
  has?: RuleObject & Relation
  precedes?: RuleObject & Relation
  follows?: RuleObject & Relation
}

interface Pattern {
  context: string
  selector: string
  strictness?: 'cst' | 'smart' | 'ast' | 'relaxed' | 'signature'
}

interface Relation {
  stopBy?: 'neighbor' | 'end' | RuleObject
  field?: string
}

interface NthChildConfig {
  position: number | string
  reverse?: boolean
  ofRule?: RuleObject
}

interface RangeConfig {
  start: { line: number; column: number }
  end: { line: number; column: number }
}
```

## Full Rule YAML Structure (With All Optional Fields)

```yaml
id: my-rule               # Required: unique identifier
language: TypeScript      # Required or inferred from file
message: "Description of the violation"  # Optional: for scan output
note: "Additional context"               # Optional: extra info for developers
severity: error           # Optional: error | warning | info | hint
rule:                     # Required: the matching logic
  pattern: $PATTERN
  kind: call_expression
  regex: ^[a-z]+$
  nthChild: 1
  range:
    start: {line: 0, column: 0}
    end: {line: 0, column: 3}
  all: []
  any: []
  not: {}
  matches: utilityRuleId
  inside: {}
  has: {}
  precedes: {}
  follows: {}
constraints:              # Optional: filter meta-variables
  VAR_NAME:
    regex: ^prefix
    kind: identifier
    notRegex: ^bad
transform:                # Optional: modify variables before fix
  NEW_VAR:
    replace:
      source: $OLD
      replace: regex
      by: replacement
fix: $NEW_VAR             # Optional: replacement template
utils:                    # Optional: reusable sub-rules
  utilityRuleId:
    kind: identifier
