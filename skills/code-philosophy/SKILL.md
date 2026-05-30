---
name: code-philosophy
description: always use this skill when planning or implementing code both frontend and backend to ensure adherence to clean code, clean architecture, SOLID principles, best practices, security, performance, logging (telemetry), and readability.
---

# Code Philosophy Skill

An expert in software craftsmanship with a deep commitment to creating maintainable, scalable, and high-quality software. This skill provides foundational coding standards that apply to ALL code (frontend and backend).

## References

Detailed content is organized into reference files for progressive loading:

| File | Content |
|------|---------|
| `references/coding-standards.md` | SOLID principles, Clean Code & Readability, Clean Architecture, Best Practices (DRY/KISS/YAGNI) |
| `references/quality-and-testing.md` | Security, Performance, Logging & Telemetry, Error Handling, Code Review Checklist, Refactoring Guide, Testing Philosophy |

## Core Principles (Summary)

### 1. SOLID Principles
- **S** — Single Responsibility: One reason to change per class/function
- **O** — Open/Closed: Extend via new code, don't modify existing
- **L** — Liskov Substitution: Subtypes must be replaceable for their parent
- **I** — Interface Segregation: Small, focused interfaces; no forced dependencies
- **D** — Dependency Inversion: Depend on abstractions, not concretions

### 2. Clean Code
- Meaningful names that reveal intent
- Small functions doing one thing (< ~20 lines)
- No side effects — prefer pure functions
- Self-documenting code (comments explain "why", not "what")

### 3. Clean Architecture
- Dependencies point INWARD (Core ← Adapters ← Infrastructure)
- Core has zero framework imports
- Use dependency injection at the composition root

### 4. Best Practices
- **DRY**: Extract duplicated logic
- **KISS**: Simplest solution works
- **YAGNI**: Only build what's needed now
- **Composition over Inheritance**

### 5. Security
- Validate all external input (schema validation)
- Secrets in environment variables, never in code
- Parameterized queries prevent SQL injection

### 6. Performance
- Prefer O(n) over O(n²) algorithms
- Lazy loading for expensive resources
- Connection pooling for databases

### 7. Logging & Telemetry
- Structured JSON logs (not console.log)
- Correlation IDs for request tracing
- Log events, not just errors

### 8. Error Handling
- Custom error classes with status codes
- Error boundaries for UI crashes
- Graceful degradation over hard failures

### 9. Testing
- Test behavior, not implementation
- Arrange-Act-Assert pattern
- Dependency injection enables testability

## Workflow

When applying the Code Philosophy skill:

1. **Analyze** — Read code and identify principle violations using the Code Review Checklist
2. **Identify** — Point out specific violations with precision (principle + file/line)
3. **Propose** — Show refactored version with before/after comparison
4. **Explain** — Describe why the fix improves maintainability, testability, security, performance, or observability
5. **Verify** — Confirm the result is buildable, lint-clean, testable, and consistent

## Code Review Checklist

- [ ] Single Responsibility
- [ ] Open/Closed
- [ ] Liskov Substitution
- [ ] Interface Segregation
- [ ] Dependency Inversion
- [ ] Meaningful Names
- [ ] Small Functions
- [ ] No Side Effects
- [ ] DRY
- [ ] KISS
- [ ] YAGNI
- [ ] Security (input validation, env vars)
- [ ] SQL Injection prevention
- [ ] Performance (optimal complexity)
- [ ] Error Handling (caught, logged, graceful)
- [ ] Logging (structured, correlation IDs)
- [ ] Tests (testable, edge cases covered)
- [ ] Clean Architecture (inward dependencies)

## Tooling

This skill ships with automated check scripts:

| Script | Purpose | Usage |
|--------|---------|-------|

### Workflow Integration

```bash
# Run validation after implementation
```

These scripts exit with code 1 if high-severity issues are found, making them suitable for CI/CD pipelines.

> **For detailed examples and patterns**, see the reference files:
> - `references/coding-standards.md` — Full SOLID, Clean Code, Architecture, and Best Practices with code examples
> - `references/quality-and-testing.md` — Security, Performance, Logging, Error Handling, Refactoring, and Testing

## Code Quality Self-Review Checklist (MANDATORY)

This checklist is the canonical quality standard for ALL agents that write code. Every Implementor must run this checklist against every created/modified file and report results.

### Enforcement

This checklist is enforced at two points:
1. **Implementor's Quality Self-Review** (Step 3a in implementor-workflow) — self-check before build
2. **Verifier's Pass 6: Quality Drift Detection** — independent validation after implementation

### The Checklist

#### ❌ BLOCKING Items (MUST pass — failure blocks the pipeline)

| # | Check | Verification Method | What To Look For |
|---|-------|---------------------|------------------|
| B1 | **Error Handling Completeness** | `grep` for `try {` / `catch` / `.catch(` near DB, network, filesystem calls | Every `async` call that touches external systems must have error handling |
| B2 | **Input Validation** | `grep` for zod/joi/class-validator schemas or `if (!x) throw` guards | Every public function accepting external data must validate before use |
| B3 | **Logging Presence** | `grep` for `logger.info\|logger.error\|console.log\|console.error` | Every public method should log success (info) or failure (error) |
| B4 | **Type Safety** | `grep` for `: any\|as any\|<any>` | No `any` types, no implicit `any` returns — every function must have explicit return type |
| B5 | **No Direct DB in Controllers** | `grep` for `db\.\|prisma\.\|\.query(\|\.execute(` in controller/service files | Database access must be behind repository/DAO layer |
| B6 | **Config from Environment** | Manual scan for hardcoded secrets, URLs, credentials | All configuration must come from `process.env` or config objects |
| B7 | **No Dangerous APIs** | `grep` for `eval(\|innerHTML\|dangerouslySetInnerHTML\|child_process.exec` | These APIs require strict justification and sanitization |
| B8 | **Parameterized Queries** | `grep` for `` `${` `` or `+` concatenation in DB query strings | Never concatenate user input into SQL/NoSQL queries |
| B9 | **DTOs/Interface Definitions** | `grep` for `interface\|type\|z.object\|Joi.object` near API boundaries | Data shapes entering/exiting the system must have type definitions |
| B10 | **No TODO/FIXME/HACK** | `grep` for `TODO\|FIXME\|HACK\|XXX\|TEMP\|WORKAROUND` | No unfinished work markers in code submitted for review |
| B11 | **No Dead Code** | Manual scan for commented-out code, unused imports, unreachable branches | Dead code is the #1 source of maintenance confusion |
| B12 | **Error Messages Are Actionable** | Manual scan of error messages | "An error occurred" is not acceptable — "Invalid email format: must contain @" is acceptable |

#### ⚠️ WARNING Items (should pass — non-blocking but reported)

| # | Check | Verification Method | What To Look For |
|---|-------|---------------------|------------------|
| W1 | **Single Responsibility** | Manual review — functions > 30 lines should be split | Each function does exactly one thing |
| W2 | **Naming Reveals Intent** | Manual review — no `data`, `info`, `temp`, `x`, `foo`, `bar` | Names should answer "what" and "why", not "how" |
| W3 | **No Magic Values** | Manual scan for unexplained string/number literals | Extract to named constants (`const MAX_RETRIES = 3` not `if (retries > 3)`) |
| W4 | **Separation of Concerns** | Manual review — controllers handle HTTP, services handle business logic | No HTTP concerns (req, res) in service layer |
| W5 | **Idempotency Consideration** | Manual review for POST/PUT endpoints | Write operations should consider idempotency (upsert, unique constraints, idempotency keys) |

### Scoring

The quality self-review produces a score used by the pipeline Code Quality Gate:

```yaml
qualitySelfReview:
  passed: true | false                    # false if any blocking item fails
  blockingItemsPassed: 12
  blockingItemsTotal: 12
  warningItemsPassed: 5
  warningItemsTotal: 5
  failures:
    - file: "src/services/user.ts"
      check: "Error Handling Completeness"  # From checklist above
      detail: "db.query() in createUser has no try/catch"
      severity: "blocking"                   # blocking | warning
      fixed: true | false
  qualityAdditions:                          # Quality improvements beyond the plan
    - "Added try/catch to UserService.createUser for database errors"
    - "Added zod schema validation for createUser input"
    - "Extracted DB queries into new UserRepository class"
    - "Added logger.info/error calls to all public methods"
    - "Created CreateUserDto interface with validation"
    - "Plan omitted error handling for createUser — checkpoint added in report"
    - "Plan specified direct DB access — extracted to repository pattern"
```

### How to Integrate

- **Implementors**: Run this checklist after the Security Self-Review and before the Pre-Build Import Validation
- **Verifiers**: Run this checklist during Pass 6 (Quality Drift Detection) to independently validate quality
- **Fixers**: Re-run this checklist after applying any fix that modifies functionality

## References

For detailed guidance on each checklist item, see:
- `references/coding-standards.md` — SOLID principles, Clean Code & Readability, Best Practices
- `references/quality-and-testing.md` — Security, Performance, Logging, Error Handling, Refactoring Guide
