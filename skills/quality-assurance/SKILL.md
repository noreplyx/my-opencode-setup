---
name: quality-assurance
description: Expert skill for ensuring software quality through comprehensive testing, bug discovery, and adherence to quality standards.
---

# Quality Assurance Skill

This skill provides a rigorous framework for validating software correctness, stability, performance, and security. Quality assurance is not merely about finding bugs — it is about building confidence that the system behaves correctly, performs reliably, and remains maintainable under change. Every test should serve a purpose: catch regressions, document expected behavior, or validate a requirement.

## Quick Navigation

Detailed content is organized into reference files for progressive loading. Load the relevant reference file when you need domain-specific guidance.

| Reference File | Load When... |
|---|---|
| `references/testing-strategies.md` | Designing test cases, choosing test types, setting up performance/security testing |
| `references/qa-workflow.md` | Following the end-to-end QA process, writing test plans, documenting results |
| `references/ci-testing.md` | Setting up CI/CD quality gates, reporting bugs, managing flaky tests |

---

## Workflow Summary

### Phase 1: Requirement Review
Review specs, identify gaps, write acceptance criteria (Given/When/Then). → See `references/qa-workflow.md` for full details

### Phase 2: Test Planning
Determine scope, design test cases (equivalence partitioning, boundary analysis), identify test data needs. → See `references/testing-strategies.md` for test design techniques

### Phase 3: Test Execution
Run automated tests, manual exploratory testing, verify edge cases, run regression, performance, and security scans. → See `references/testing-strategies.md` for test types, `references/ci-testing.md` for prioritization

### Phase 4: Bug Triage & Retesting
Log bugs using the standard template, classify by severity/priority, assign, retest after fixes. → See `references/ci-testing.md` for bug reporting standards

### Phase 5: Release Sign-Off
Verify smoke tests pass, no S1/S2 bugs open, coverage thresholds met, security scan clean. → See `references/qa-workflow.md` for the full sign-off checklist

### Phase 6: Post-Release Monitoring
Monitor error rates, verify production smoke tests, review user-reported bugs. → See `references/qa-workflow.md` for monitoring guidelines

---

## Core Principles

- **Prefer integration tests** over unit tests for business logic with side effects. Prefer E2E for critical money/security flows.
- **Smoke tests must be fast** (< 5 minutes) and reliable (zero flakiness). If a smoke test fails, abort the full suite and roll back.
- **Treat accessibility bugs as S2 (major)** by default. Automated a11y checks belong in every PR pipeline.
- **Every bug report must have clear reproduction steps**, environment details, and severity classification.
- **Prefer fakes** for databases and file systems; prefer mocks only for external I/O boundaries.
- **Document acceptance criteria** using Given/When/Then format for unambiguous pass/fail conditions.
- **Always include boundary value analysis** for numeric and date inputs.

## Hard Rules

- ❌ NEVER skip smoke tests before full test suite execution
- ❌ NEVER leave flaky tests in the critical CI path — quarantine them
- ❌ NEVER deploy with known S1 (critical) bugs open
- ✅ ALWAYS document acceptance criteria as Given/When/Then
- ✅ ALWAYS include boundary value analysis for numeric/date inputs
- ✅ ALWAYS run security scans for changes touching auth, input handling, or data access

---

## Tooling (Automated Checks)

This skill includes an executable script that performs automated QA readiness checks.

### Available Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `check-qa.ts` | Analyzes project for test coverage, test config, linter setup, CI pipeline, TS strict mode | `ts-node <skills-dir>/scripts/quality-assurance/check-qa.ts --dir=<project-dir> [--ci]` |

### What It Checks

| Area | Checks |
|------|--------|
| Testing | Test files exist, jest/vitest configured, test script in package.json, coverage script |
| Config | TypeScript strict mode, ESLint config, Prettier config |
| CI | GitHub Actions workflow presence |
| E2E | Playwright configuration |

### CI Integration

Use the `--ci` flag to make the script exit with code 1 on failure, suitable for CI pipeline gating:

```bash
ts-node skills/scripts/quality-assurance/check-qa.ts --dir=./ --ci
```

---

> **For detailed guidance**, load the appropriate reference file:
> - `references/testing-strategies.md` — Test pyramid, functional/integration/performance/security testing, smoke tests
> - `references/qa-workflow.md` — Full QA workflow phases, test documentation, acceptance criteria
> - `references/ci-testing.md` — CI/CD quality gates, regression testing, flaky tests, accessibility, bug reporting
