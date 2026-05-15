---
name: qa-workflow
description: Detailed reference for the end-to-end QA process, test documentation formats, and acceptance criteria standards.
---

## Table of Contents

1. [QA Workflow — 6 Phases](#qa-workflow--6-phases)
2. [Test Documentation](#test-documentation)
3. [Acceptance Criteria Format](#acceptance-criteria-format)

---

## QA Workflow — 6 Phases

Follow this process for every feature, bug fix, or release.

### Phase 1: Requirement Review

1. Read the PR description, ticket, or specification.
2. Identify gaps, ambiguities, and missing edge cases.
3. Write acceptance criteria if not provided (Given/When/Then).
4. **Output**: Reviewed requirements + acceptance criteria.

### Phase 2: Test Planning

1. Determine test scope (what to test, what to skip).
2. Design test cases using equivalence partitioning and boundary analysis.
3. Identify test data needs (seed data, mocks, fixtures).
4. Choose test type distribution (unit vs integration vs E2E).
5. **Output**: Test plan document or test case list.

### Phase 3: Test Execution

1. Run all automated unit/integration tests.
2. Execute manual exploratory tests for the feature area.
3. Verify edge cases, error paths, and boundary values.
4. Run regression tests for affected areas.
5. Run performance test if the change affects a hot path.
6. Run security scan if the change touches auth, input handling, or data access.
7. **Output**: Test results, bug reports for found issues.

### Phase 4: Bug Triage & Retesting

1. Log all bugs using the bug report template.
2. Classify by severity and priority.
3. Assign bugs to developers.
4. After fixes are deployed to a test environment, retest and close verified bugs.
5. **Output**: Closed bugs, updated traceability matrix.

### Phase 5: Release Sign-Off

1. Verify smoke tests pass on the release candidate.
2. Confirm no S1/S2 bugs open.
3. Verify coverage thresholds are met.
4. Ensure security scan is clean (no critical/high CVEs).
5. **Output**: Signed-off release candidate ready for production.

### Phase 6: Post-Release Monitoring

1. Monitor production error rates and performance metrics for 24-48 hours.
2. Verify smoke tests pass in production.
3. Review any new bugs filed by users.
4. **Output**: Release retrospective notes for the next sprint.

---

## Test Documentation

Good documentation makes tests maintainable, auditable, and valuable for onboarding.

### Test Plan Structure

```
1. Scope (what is being tested and what is out of scope)
2. Test Strategy (types of tests, tools, environment)
3. Test Schedule (milestones, regression schedule)
4. Entry / Exit Criteria
   - Entry: Code complete, build stable, environment ready
   - Exit: All P0/P1 tests pass, no S1 bugs open, coverage >= 80%
5. Roles & Responsibilities
6. Risks & Mitigations
7. Test Deliverables (test cases, reports, bug list)
```

### Test Case Format

| Field | Example |
|---|---|
| **ID** | TC-LOGIN-001 |
| **Title** | Login with valid credentials |
| **Preconditions** | User is registered and not locked out |
| **Test Data** | `username=alice`, `password=ValidP@ss1` |
| **Steps** | 1. Navigate to /login. 2. Enter username. 3. Enter password. 4. Click "Sign In". |
| **Expected Result** | User is redirected to dashboard. Welcome message shows "Hello, Alice!" |
| **Actual Result** | (filled during test execution) |
| **Status** | Pass / Fail / Blocked |

### Traceability Matrix

A traceability matrix maps requirements → test cases → test results.

| Req ID | Requirement | Test Case ID(s) | Status |
|---|---|---|---|
| REQ-AUTH-01 | User can log in with email and password | TC-LOGIN-001, TC-LOGIN-002 | ✅ Pass |
| REQ-AUTH-02 | Locked user gets "Account locked" message | TC-LOGIN-005 | ✅ Pass |
| REQ-AUTH-03 | Password reset email sent within 30 seconds | TC-LOGIN-010 | ❌ Fail — timeout > 30s |

Maintain this matrix in a spreadsheet or test management tool (TestRail, Xray, Zephyr). Update after every test cycle.

---

## Acceptance Criteria Format

All acceptance criteria should be written using the **Given/When/Then** format:

```
Scenario: User resets their password
  Given the user is on the login page
    And the user has a registered email address
  When the user submits the "Forgot Password" form with their email
  Then a password reset email is sent to that address
    And the user sees a confirmation message "Check your inbox"
```

This format ensures clarity, testability, and unambiguous pass/fail conditions for every scenario.
