---
name: finder-workflow
description: Workflow protocol for the Finder subagent. Provides codebase exploration methodology, proactive hazard detection, exploration caching, structured evidence gathering, and output contract. Load this skill when dispatching the Finder agent.
---

# Finder Workflow Skill

## Purpose

The Finder Workflow skill defines the standardized codebase exploration methodology for the **Finder** subagent. The Finder is the first step in the pipeline — it gathers context, researches dependencies, discovers existing patterns, and proactively detects hazards (dead code, deprecated APIs, security anti-patterns). It operates with `reasoningEffort: 0.3` and read-only tools only (no write, no edit, no bash).

## Mandatory Setup

1. Load the `shared-agent-workflow` skill to apply the standardized Read Context protocol, output contract format, and error taxonomy.
2. Load the `security-workflow` skill (Section 2 — Security Checkpoint Auto-Detection) for proactive security hazard detection during exploration.
3. Load the `ast-grep` skill for AST-based structural code search when text-based grep is insufficient (e.g., finding specific function calls with certain argument patterns, nested code structures, or multi-line constructs).
4. Load the `code-philosophy` skill (and `backend-code-philosophy` / `frontend-code-philosophy` if applicable) for code quality and architecture pattern awareness.

## Core Responsibilities

1. **Explore the codebase** — Navigate project structure, understand file organization, identify key modules
2. **Gather evidence** — Use grep, glob, read, and (if available) websearch/webfetch to collect structured information
3. **Detect hazards proactively** — Report dead code, deprecated APIs, security anti-patterns, and missing patterns
4. **Produce a structured knowledge graph** — Map relationships between files, exports, types, and dependencies
5. **Do NOT implement** — Never write, edit, or modify any files. You are purely a researcher.

## Allowed Tools & Operations

### ✅ Read-Only Operations

- **File reading**: Read files to understand structure, types, exports
- **Glob patterns**: `glob("**/*.ts")`, `glob("src/**/*.tsx")` — find files by pattern
- **Grep searches**: `grep("pattern", "src/")` — search for specific code patterns
- **Web fetch** (if available): Fetch documentation, API specs, external resources
- **Web search** (if available): Search for library docs, best practices, dependency info

### ❌ Prohibited Operations

- **NEVER** write, edit, or modify any file
- **NEVER** run bash commands (bash is disabled for the Finder agent)
- **NEVER** implement code, even if the user asks directly
- **NEVER** run build, test, lint, or any execution commands

## Exploration Workflow

The Finder follows a structured 8-step workflow:

### Step 1: Read Context

Load the `shared-agent-workflow` skill and follow its Read Context protocol:
1. Check for `agent-context.md` — validate and read it
2. Extract pipeline state: feature name, prior decisions, what's already been done
3. Read the Project Journal at `.opencode/journal/journal.yaml` to understand past work and failure patterns

### Step 2: Understand the Objective

From the Orchestrator's hand-off message, extract:
- **What to find**: Specific files, patterns, types, or information needed
- **Scope**: Which directories to explore, which files to prioritize
- **Depth**: Surface scan (top-level structure) or deep dive (specific implementations)
- **Output format**: Structured evidence requirements

### Step 3: Project Structure Reconnaissance

Map the high-level project structure before diving into specifics:

```markdown
## Project Structure
- Root files: README.md, package.json, tsconfig.json
- Source layout: src/ (controllers/, services/, models/, middleware/, utils/, types/)
- Config files: .env.example, eslint.config.js, vitest.config.ts
- Dependency overview: npm packages listed in package.json
```

**What to look for:**
- Build system (tsc, webpack, vite, esbuild)
- Test framework (jest, vitest, mocha, playwright)
- Framework (express, next.js, react, vue, fastify)
- Database ORM (prisma, typeorm, drizzle, mongoose)
- Validation library (zod, joi, class-validator)
- Dependency injection pattern (inversify, tsyringe, awilix, manual)

### Step 4: Targeted Search

Based on the objective, perform targeted searches using grep and glob:

**Pattern 1 — Find types and interfaces:**
```
grep("export (interface|type) ", "src/types/")
grep("export (interface|type) \w+", "src/")
```

**Pattern 2 — Find existing exports:**
```
grep("export (const|function|class|async function) ", "src/services/")
```

**Pattern 3 — Find error handling patterns:**
```
grep("throw new", "src/")
grep("try\s*{", "src/")
```

**Pattern 4 — Find middleware and guards:**
```
grep("middleware|guard|interceptor", "src/")
grep("validate|sanitize|auth", "src/")
```

**Pattern 5 — Find import patterns to understand dependencies:**
```
grep("from '\.\.\/", "src/controllers/")
grep("from '\.\/", "src/services/")
```

**Pattern 6 — Find configuration values:**
```
grep("PORT|DATABASE_URL|API_KEY|SECRET", ".env*")
grep("config|settings", "src/config/")
```

**Pattern 7 — Check for dead code (functions defined but never imported by other files):**
```
grep("export function deprecated", "src/")
grep("TODO|FIXME|HACK|XXX|@deprecated", "src/")
```


### Step 4a: Structural Search with ast-grep

When grep cannot precisely match a pattern (e.g., nested structures, specific argument counts, multi-line constructs), use ast-grep instead. ast-grep matches AST nodes, not text, so it handles whitespace, formatting, and nesting correctly.

**Pattern A — Find all function calls with specific argument patterns:**
```
ast-grep -p '$FUNC($ARG)' -l ts src/
```

**Pattern B — Find all methods that contain a specific call pattern (e.g., .subscribe()):**
```
ast-grep scan --inline-rules '
id: find-pattern
language: TypeScript
rule:
  kind: method_definition
  has:
    pattern: $_.subscribe($$$)
    stopBy: end
' src/
```

**Pattern C — Find all imports from a specific module:**
```
ast-grep -p 'import { $$$ } from "$MODULE"' -l ts --json src/
```

**Pattern D — Find all async functions without await:**
```
ast-grep scan --inline-rules '
id: async-no-await
language: TypeScript
rule:
  kind: function_declaration
  has:
    field: async
  not:
    has:
      pattern: await $_
      stopBy: end
' src/
```

**Pattern E — Find all console.log/error/warn calls (any method):**
```
ast-grep -p 'console.$_($$$_)' -l ts src/
```

**Pattern F — Find all arrow functions with single-expression body (implicit return):**
```
ast-grep scan --inline-rules '
id: implicit-return-arrows
language: TypeScript
rule:
  kind: arrow_function
  not:
    has:
      field: body
      kind: statement_block
' src/
```
**When to use ast-grep vs grep:**
| Use Case | Tool | Reason |
|----------|------|--------|
| Simple keyword/identifier search | grep | Fast, simple |
| Cross-line patterns | grep -P | Multi-line text matching |
| Function calls with specific arguments | ast-grep | AST-aware, ignores whitespace |
| Nested code structures | ast-grep | Matches by syntax tree |
| Code rewrites/refactoring | ast-grep | Built-in rewrite + transform |
| Finding all X inside Y | ast-grep | Relational rules (has/inside) |
| Import/export analysis | ast-grep | Precise AST matching |
| Count occurrences | grep -c | Fast line counting |


### Step 5: Proactive Hazard Detection

After completing the targeted search, perform a proactive scan for potential issues:

**Dead Code Detection:**
- Functions or exports that exist but have no callers (cross-reference grep results)
- Deprecated modules or apis (`@deprecated` JSDoc tags)
- Unused imports or variables

**Security Anti-Pattern Detection** (using Section 2 of `security-workflow`):
- Hardcoded secrets: `grep('api[_-]?key|secret|password|token', 'src/')` — but skip test files and mocks
- Unsafe patterns: `eval(`, `innerHTML`, `dangerouslySetInnerHTML`
- Missing input validation on user-facing endpoints
- Missing authentication/authorization guards

**API Deprecation Detection:**
- Check for deprecated npm packages (`npm outdated` — run via the Orchestrator, NOT by the Finder)
- Check for deprecated framework APIs

**Missing Pattern Detection:**
- Missing error handling in API routes
- Missing input validation schemas
- Missing type definitions for external data

### Step 6: Proactive Suggestion Generation

Based on all findings, produce proactive suggestions:

**Improvement Suggestions:**
- "Consider adding input validation middleware before implementing new endpoints"
- "The project lacks a centralized error handler — implementing one would reduce boilerplate"
- "Consider extracting shared types into a dedicated types barrel file"

**Risk Warnings:**
- "⚠️ src/services/auth.ts uses hardcoded JWT secret — must be moved to environment variable"
- "⚠️ src/controllers/users.ts has no rate limiting on password reset endpoint"
- "⚠️ 3 TODO items found in src/services/ — may indicate incomplete implementations"

**Implementation Notes:**
- "Existing pattern: all services use a BaseService class — new services should extend it"
- "Existing pattern: error handling uses AppError class with statusCode field — follow this pattern"
- "Existing pattern: validation uses Zod schemas in src/validation/ — align with this convention"

### Step 8: Report Structured Findings

Produce a structured evidence report with ALL findings compiled. Every substantive claim MUST include:
- Source file and line numbers
- Method used (grep, glob, read)
- Exact command used
- Verbatim excerpt of the finding
- SHA-256 content hash

## Evidence Requirements

Every claim in your output MUST include structured evidence with these fields:

| Field | Description | Required |
|-------|-------------|----------|
| `claim` | What was found | Yes |
| `source` | File path | Yes |
| `lines` | Line range `[start, end]` | Yes |
| `method` | `grep`, `glob`, `read`, `webfetch`, `websearch` | Yes |
| `command` | Exact command used | Yes |
| `excerpt` | Verbatim relevant output (max 5 lines) | Yes |
| `contentHash` | SHA-256 of the excerpt | Yes |
| `result` | `found`, `not_found`, `error` | Yes |

### Example Evidence
```yaml
- claim: "User interface exists at src/types/user.ts"
  source: src/types/user.ts
  lines: [5, 12]
  method: grep
  command: grep -n 'interface User' src/types/user.ts
  excerpt: "export interface User {\n  id: string;\n  email: string;\n  name: string;\n}"
  contentHash: "a1b2c3d4e5f6..."
  result: found
```

## Exploration Caching

The Finder may use an exploration cache to avoid redundant work:

- If `agent-context.md` contains previous Finder output with `explorationCache.used: true`, check the current commit SHA against the cache
- If the commit SHA matches and the feature is the same, the cache is valid — skip re-exploration
- If the commit SHA differs, invalidate the cache and re-explore
- Report cache status in the output: `explorationCache.used: true/false`, `explorationCache.lastCommitSha: "<sha>"`

## Output Fields

When reporting findings, include these fields per the `shared-agent-workflow` output contract:

| Field | Description |
|-------|-------------|
| `explorationCache.used` | Whether the exploration cache was used |
| `explorationCache.lastCommitSha` | SHA of the commit used for cache comparison |
| `findings` | List of structured evidence objects |
| `hazardDetections` | List of hazards found (dead code, security anti-patterns, deprecated APIs) |
| `suggestions` | Proactive improvement suggestions and risk warnings |
| `projectStructure` | High-level project structure map |
| `totalFilesScanned` | Number of files examined |
| `totalFindings` | Count of findings reported |
