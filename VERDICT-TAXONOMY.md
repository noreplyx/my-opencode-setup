# Verdict Taxonomy

All reviewer agents in the multi-agent workflow use a single, shared verdict vocabulary. This ensures the Orchestrator can gate workflow steps deterministically and that every agent's output is interpreted consistently.

## Allowed Verdicts

| Verdict | Meaning | Blocking? |
| --- | --- | --- |
| `pass` | The artifact meets all requirements for this reviewer. No concerns remain. | No |
| `pass-with-concerns` | The artifact is acceptable, but the reviewer has noted non-blocking concerns, risks, or recommendations. | No |
| `reject` | The artifact is not acceptable. The reviewer has identified one or more blockers that must be resolved before the workflow proceeds. | Yes |
| `not-applicable` | The reviewer's scope does not apply to the current task or artifact. The reviewer takes no gating position. | No |

## Gate-Type Matrix

The Orchestrator enforces five distinct gates. The same verdict is interpreted the same way at every gate:

| Verdict | Plan review gate<br>(Architecture, Engineer, Security, QA review the plan) | Lint Gate<br>(Linter runs project-local lint/style checks) | Test Gate<br>(Tester runs project-local tests and checks AC coverage) | Security scan gate<br>(Security scans implemented code) | QA verification gate<br>(QA verifies implemented code) |
| --- | --- | --- | --- | --- | --- |
| `pass` | Proceed to implementation. | Proceed to Test Gate. | Proceed to Security Gate. | Proceed to QA verification. | Proceed to final report. |
| `pass-with-concerns` | Proceed; surface concerns in the consolidated review feedback and final report. | Proceed to Test Gate; list concerns in the lint summary. | Proceed to Security Gate; list coverage concerns in the test summary. | Proceed to QA verification; list concerns in the security scan summary. | Proceed to final report; list concerns in the QA summary. |
| `reject` | Route the plan back to the `planner` agent for revision. Do not advance to `coder`. | Route findings back to `planner` → `coder` for fixes, then re-run this gate. | Route findings back to `planner` → `coder` for fixes, then re-run this gate. | Route the plan and findings back to the `planner` agent. Return to `coder` for remediation, re-run lint and test gates, then re-run this gate. | Route the plan and findings back to the `planner` agent. Return to `coder` for remediation, re-run lint, test, and security scan gates, then re-run this gate. |
| `not-applicable` | Ignore this reviewer's verdict for gating; note it in the report. | Ignore for gating if the project has no local linter; note it in the report. | Ignore for gating if the project has no local test runner; note it in the report. | Ignore for gating if the security scope does not apply (e.g., no running web app for OWASP ZAP); note it in the report. | Ignore for gating if the QA scope does not apply; note it in the report. |

## Rules

- A reviewer MUST return exactly one of the four verdicts.
- `reject` is the only verdict that blocks advancement.
- `pass-with-concerns` is never a blocker. The concerns must still be visible to the user in the final report.
- `not-applicable` is allowed when the reviewer's domain is irrelevant to the task (e.g., a web-app scanner against a CLI project). It must be stated explicitly and not used to avoid doing required work.
- The Orchestrator treats all reviewer verdicts uniformly: any `reject` at a gate prevents the workflow from advancing past that gate until the `planner` has updated the plan and the responsible agent has resolved the issue.

## Enforcement

A validator script enforces this taxonomy against the `agents/*.md` files. Run it manually with:

```bash
scripts/validate-verdict-taxonomy.ts
```

The validator checks that:

- `VERDICT-TAXONOMY.md` exists and defines the expected verdicts.
- Reviewer agent files contain a top-level `- Verdict:` line.
- The verdict line only uses the allowed values (`pass`, `pass-with-concerns`, `reject`, `not-applicable`).
- The verdict line references `VERDICT-TAXONOMY.md`.
- No old verdict terms (`approve`, `approve-with-concerns`, `request-changes`, `block`) appear in top-level Verdict lines.

The script exits with a non-zero status if any agent file violates the taxonomy.
