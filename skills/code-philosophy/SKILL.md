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
- Validate all external input (Zod schemas)
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
| `check-solid.ts` | Scans for SRP, OCP, and DIP violations | `ts-node skills/scripts/code-philosophy/check-solid.ts --dir=<project-dir>` |
| `check-clean-code.ts` | Detects long functions, magic numbers, TODOs | `ts-node skills/scripts/code-philosophy/check-clean-code.ts --dir=<project-dir>` |
| `check-security.ts` | Scans for hardcoded secrets, SQL injection | `ts-node skills/scripts/code-philosophy/check-security.ts --dir=<project-dir>` |

### Workflow Integration

```bash
# Run validation after implementation
ts-node skills/scripts/code-philosophy/check-solid.ts --dir=./
ts-node skills/scripts/code-philosophy/check-clean-code.ts --dir=./
ts-node skills/scripts/code-philosophy/check-security.ts --dir=./
```

These scripts exit with code 1 if high-severity issues are found, making them suitable for CI/CD pipelines.

> **For detailed examples and patterns**, see the reference files:
> - `references/coding-standards.md` — Full SOLID, Clean Code, Architecture, and Best Practices with code examples
> - `references/quality-and-testing.md` — Security, Performance, Logging, Error Handling, Refactoring, and Testing
