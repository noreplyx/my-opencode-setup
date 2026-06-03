# Output Verification

## Structured Output Enforcement

All agents MUST return structured output with YAML frontmatter:

```yaml
---
status: "completed" | "failed" | "partial"
resultSummary: "Summary"
agentOutputs:
  <agent>:
    status: "..."
    resultSummary: "..."
    buildPassed: true | false | null
    lintPassed: true | false | null
decisions:
  - what: "..."
    why: "..."
    by_who: "..."
warnings: []
changedFiles: []
artifacts: []
---
```

## Per-Agent Responsibility Table

| Agent | buildPassed/lintPassed? | decisions? | changedFiles? | Enhanced Fields? |
|---|---|---|---|---|
| Finder | No | Yes | No | Yes — knowledgeGraph |
| PlanDescriber | No | Yes | Yes (manifest) | Yes — confidence |
| Implementor | Yes (mandatory) | No | Yes | Yes — selfReview |
| QA | No | Yes | Yes | Yes — edge cases, security coverage |
| Verifier | No | No | No | Yes — suggestedCheckpoints, driftDetection |
| Fixer | Yes (mandatory) | Yes | Yes | Yes — rootCauseAnalysis |
| Browser Tester | No | No | Yes | No |
| Integrator | No | Yes | No | Yes — consistency report |
| Documentor | No | Yes | Yes | No |

## Rejection Protocol

If `validate-output-contract.ts` exits non-zero:

1. Reject output.
2. Report errors to agent.
3. One retry allowed.
4. Escalate if fails twice.

## Automated Validation Gate

After every agent hand-off:

```bash
ts-node skills/scripts/orchestration/validate-output-contract.ts --pipeline
```

MANDATORY — cannot be skipped.