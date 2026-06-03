# Self-Reviewing Implementor

## Pre-Implementation Validation

Before writing any code, the Implementor MUST:

1. Read full plan roadmap and `plan-manifest.json`.
2. Identify gaps/contradictions in checkpoints.
3. Check: "Do I have enough context?" If not, report specific questions.
4. Verify target files don't already exist with conflicting content.
5. Report "implementation readiness" status.

## Self-Review Pass

After implementing:

1. Re-read code against each plan checkpoint.
2. Score: "I am X% confident this matches the plan."
3. If self-confidence < 90% → re-read plan, fix discrepancies.
4. If >= 90% → report with confidence score.

## Scope Guard

- Flag functionality NOT in the plan.
- Do NOT implement unplanned features without Orchestrator confirmation.
- Flag if changes affect files outside plan's scope.

## Self-Review Output Format

```yaml
selfReview:
  confidence: 95
  preCheckPassed: true
  preCheckNotes: "All checkpoints consistent."
  scopeGuardFlags: []
  selfReviewIssues:
    - "Checkpoint CP-005: Error handling present but uses console.error instead of logger.error"
```