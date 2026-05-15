---
name: ci-testing
description: Detailed reference for CI/CD quality gates, regression testing, test prioritization, flaky test management, accessibility testing, and bug reporting standards.
---

## Table of Contents

1. [QA in CI/CD](#qa-in-cicd)
2. [Regression Testing](#regression-testing)
3. [Test Impact Analysis](#test-impact-analysis)
4. [Test Prioritization](#test-prioritization)
5. [Flaky Test Management](#flaky-test-management)
6. [Gating Strategy](#gating-strategy)
7. [Accessibility Testing](#accessibility-testing)
8. [Bug Reporting Standards](#bug-reporting-standards)

---

## QA in CI/CD

Integrating quality gates into the pipeline ensures consistent quality without relying on manual gates.

### Pipeline Stage Timing

| Pipeline Stage | Tests Run | Gate? |
|---|---|---|
| **pre-commit / pre-push** | Lint, type check, unit tests, smoke tests | Yes — block push if failed |
| **PR (feature branch)** | All unit + integration tests, SAST, dependency scan, coverage diff | Yes — block merge if failed |
| **Staging deploy** | E2E tests, performance tests, DAST | Yes — block promotion if failed |
| **Production deploy** | Smoke tests, canary analysis | Soft gate — alert but allow if canary passes |
| **Nightly** | Full regression suite, visual regression, long-running perf tests | No blocking — report in morning standup |

---

## Regression Testing

**Goal**: Ensure new changes do not break existing functionality.

### Test Selection Strategies

- **Minimized**: Run only tests affected by the code change (test impact analysis). Fastest, highest risk of missing bugs.
- **Risk-Based**: Run all tests in high-risk areas (payment, auth) + impacted tests. Recommended for most commits.
- **Full Suite**: Run everything. Slowest, safest. Use only for release candidates or nightly builds.

### Tools

- **Jest --onlyChanged** / **Vitest --changed**: Run tests related to changed files.
- **nx affected:test**: Monorepo-aware test selection.
- **Coverage diff**: Fail CI if coverage decreases in changed files.

---

## Test Impact Analysis

Identify which tests are affected by a change:

1. Parse the git diff to list changed files.
2. Map files to test files using code coverage data or dependency graph.
3. Run only the mapped tests plus all tests in the "critical path."

---

## Test Prioritization

| Priority | When to Run | Examples |
|---|---|---|
| P0 (Critical) | Every commit, pre-merge | Auth flows, payment, data loss scenarios |
| P1 (High) | Every PR, nightly | CRUD operations, search, reporting |
| P2 (Medium) | Nightly | Edge cases, UI polish, non-critical paths |
| P3 (Low) | Weekly | Visual regression, deprecated feature paths |

---

## Flaky Test Management

- **Detection**: Tag tests as `@flaky` if they fail > 5% of runs without a real bug.
- **Quarantine**: Move flaky tests to a separate CI job that does not block the pipeline.
- **Resolution**: Require a bug ticket before un-quarantining. Triage within 1 sprint.
- **Tooling**: Use `jest --rerun-failed` / `cypress --retries` as a short-term band-aid only.

---

## Gating Strategy

- **Required checks**: All P0 + P1 tests must pass. Coverage must not decrease.
- **Soft checks**: P2 tests, performance budgets — warn but do not block.
- **Emergency override**: Engineering lead can bypass the gate with written justification (logged in audit trail).

---

## Accessibility Testing

Accessibility (a11y) testing ensures the application is usable by people with disabilities. Treat accessibility bugs as S2 (major) by default.

### Automated Testing

| Tool | What It Checks | How to Run |
|---|---|---|
| **axe-core** (axe DevTools) | WCAG 2.2 AA violations in rendered DOM | `npx axe http://localhost:3000` or in E2E tests |
| **Lighthouse** | a11y score, best practices, perf | `npx lighthouse http://localhost:3000 --preset=desktop` |
| **WAVE** | Visual overlay of a11y issues | Browser extension |
| **pa11y** | CI-friendly a11y assertions | `npx pa11y http://localhost:3000` |
| **eslint-plugin-jsx-a11y** | Catch issues at dev time (missing alt, role, label) | ESLint rule |

```javascript
// Playwright + axe example
const { injectAxe, checkAxe } = require('axe-playwright');

test('home page has no accessibility violations', async ({ page }) => {
  await page.goto('/');
  await injectAxe(page);
  const results = await checkAxe(page);
  expect(results.violations).toHaveLength(0);
});
```

### Manual Testing Checklist

- [ ] **Keyboard navigation**: Tab through all interactive elements. Is focus order logical? Is there a visible focus indicator?
- [ ] **Screen reader**: Narrator (Windows), VoiceOver (macOS/iOS), TalkBack (Android). Listen to the full flow.
- [ ] **Color contrast**: Check all text/background combos. Minimum ratio 4.5:1 for normal text, 3:1 for large text.
- [ ] **Zoom**: 200% zoom in browser — no content clipped or overlapping.
- [ ] **Reduced motion**: With `prefers-reduced-motion: reduce`, animations should be disabled or replaced.
- [ ] **Form labels**: Every input has an associated `<label>` or `aria-label`.

---

## Bug Reporting Standards

Every bug report must contain enough information for a developer to reproduce and triage without additional back-and-forth.

### Bug Report Template

```markdown
## Summary
[One-line description of the issue]

## Environment
- **Environment**: [staging / production / local]
- **Browser / OS**: [Chrome 120 / Windows 11]
- **Commit / Version**: [abc1234 / v2.5.1]
- **Feature Flag Status**: [enabled flags, if applicable]

## Steps to Reproduce
1. Go to [page / endpoint]
2. Enter [specific input]
3. Click [button]
4. Observe [unexpected behavior]

## Expected Behavior
[What should happen]

## Actual Behavior
[What actually happens]

## Logs / Screenshots
```
[Relevant logs, stack traces, or HAR files]
```
[Attach screenshot or screen recording if UI-related]

## Severity & Priority
| Severity | Priority | Meaning |
|---|---|---|
| S1 - Critical | P0 | App crash, data loss, security breach |
| S2 - Major | P1 | Major feature broken, no workaround |
| S3 - Minor | P2 | Non-critical feature broken, has workaround |
| S4 - Trivial | P3 | Cosmetic, typo, minor UI misalignment |
```

### Triaging Rules

- **S1/P0**: Stop the line. Fix immediately, rollback if needed.
- **S2/P1**: Fix within the current sprint.
- **S3/P2**: Schedule in the next sprint.
- **S4/P3**: Add to backlog, may never be fixed.
