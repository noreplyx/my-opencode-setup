# Agent Hand-off Reference

## Hand-off Checklist (Enhanced)

When passing work from one agent to the next, the Orchestrator MUST include:

1. **Context Summary**: What was done in the previous step(s), with evidence citations
2. **Artifacts**: Relevant file paths, outputs, or data produced
3. **Previous Evidence**: Structured evidence from prior agent(s) with content hashes
4. **Clear Objective**: Exactly what the next agent should do
5. **Constraints**: Any boundaries, rules, or restrictions
6. **Expected Output**: What the agent should return/report (structured output contract with evidence)
7. **Agent Output Format reminder**: "Return your results with the structured output contract (status, resultSummary, evidence, decisions, warnings, changedFiles, artifacts, buildPassed/lintPassed where applicable)"
8. **Evidence Minimum**: "Provide at least <N> evidence entries: one per <claim-type>"
9. **Evidence Requirements**: "Include evidence for every substantive claim with contentHash, line numbers, exact commands, and verbatim excerpts"
10. **Run Hand-off Check**: Before dispatch, run `check-handoff.ts`
11. **Visual Generation**: After the agent returns, generate the appropriate pipeline visualization

---

## Evidence Format

```
Previous Evidence (from <agent>):
  - Claim: "<claim>"
    Source: <file>, Lines [start, end]
    ContentHash: <sha256>
    Method: grep/read/stat
    Command: <exact command>
    Excerpt: "<relevant output>"
    Result: found/passed
```

### Evidence Contract Fields

| Field | Required | Description |
|-------|----------|-------------|
| `claim` | [x] | What the agent claims to be true (e.g., "File X exists", "Build passed", "Export Y found") |
| `source` | [x] | File path, or `build`/`lint`/`test` for non-file evidence |
| `lines` | [ ] | Specific line numbers [start, end] |
| `method` | [x] | How the evidence was obtained: `grep`, `read`, `stat`, `glob`, `test`, `build`, `lint`, `run`, `analysis` |
| `command` | [x] | The exact command that was run to obtain this evidence |
| `excerpt` | [x] | Relevant output excerpt proving the claim |
| `result` | [x] | `found`, `not_found`, `passed`, `failed`, `exists`, `not_exists`, `verified`, `analysis_complete` |

---

## Example Hand-offs

### Orchestrator → PlanDescriber (with Finder findings)

```
"After brainstorming with the user, we've agreed on Option B (modular monolith approach).
Finder has analyzed the codebase (see files: src/services/user.ts, src/models/user.ts).
Please create a detailed implementation roadmap for adding user profile management,
following the code-philosophy and backend-code-philosophy skills.
Focus on: data models, service layer, and API endpoints."
```

### Orchestrator → Fixer (with Verifier deviation report)

```
"The Verifier reported 72% compliance on the user-profile feature.
Plan manifest: plan-manifests/user-profile/v1-manifest.json
Deviations:
- CP-003: exportExists 'validateEmail' -- not found in src/services/user.ts
- CP-007: handlesError 'createUser' -- no error handling for duplicate email

QA smoke test passed. Build and lint passed.
Please diagnose the root cause and apply targeted fixes."
```

### Orchestrator → Verifier (with QA results)

```
"The plan manifest is at plan-manifests/user-profile-manifest.json.
Implementation added UserService with createUser and getUser methods.
QA smoke test passed. Security scan passed (no High/Critical vulnerabilities).
Please verify all checkpoints in the manifest and report the compliance score."
```

### Verifier → Documentor Hand-off

```
"The user-profile feature has passed all gates including verification (100% compliance).
Plan manifest checkpoints all pass. QA smoke test passed. Acceptance criteria passed.

Changed files:
- src/services/user.service.ts (NEW)
- src/controllers/user.controller.ts (NEW)
- src/types/user.types.ts (NEW)

Please update:
1. JSDoc on all new exports
2. README.md with new API endpoints
3. CHANGELOG.md with [Unreleased] entries
4. No migration guide needed (no breaking changes)"
```

### Orchestrator → Implementor (with evidence)

```
"After brainstorming and planning, we've agreed on the user-profile feature.
Plan manifest: plan-manifests/user-profile/v1-manifest.json
Target files: src/services/user.ts, src/controllers/user.ts

Prior evidence from Finder:
- Evidence: User model exists at src/models/user.ts (line 5: interface User)
- Evidence: Zod is already in the dependency tree (package.json: "zod": "^3.22.0")

Your task:
1. Create src/services/user.ts with UserService class (exports: createUser, getUser)
2. Create src/controllers/user.ts with UserController (handlers for POST/GET)

Constraints:
- Must NOT modify src/models/user.ts (it already exists)
- Must use Zod for input validation (not Joi -- it's not installed)

Expected output:
- Structured YAML with evidence for each file created, build pass, lint pass
- Minimum 3 evidence entries: 2x fileExists (stat), 1x buildPass (build)

Definition of Done:
- Build passes: npm run build
- Lint passes: npm run lint (or 'No linter configured')
- Files exist with correct exports"
```

---

## Evidence Hand-off Protocol

When handing off between agents, the Orchestrator MUST include structured evidence from the PRIOR agent's work.

**Format:**

```markdown
Previous Evidence:
  - Claim: "User model exists at src/models/user.ts"
    Source: src/models/user.ts, Lines 5-20
    ContentHash: a1b2c3d4e5f6...
    Method: grep
    Command: grep -n 'interface User' src/models/user.ts
    Excerpt: "interface User { email: string; name: string; }"
    Result: found
  - Claim: "Validation middleware exists"
    Source: src/middleware/validation.ts, Lines 1-50
    Method: read
    Command: head -50 src/middleware/validation.ts
    Excerpt: "export function validateRequest(...)"
    Result: found
```

This ensures downstream agents have **verified facts**, not paraphrased summaries.

---

## Fixer Feedback Loop

```
QA/Verifier reports issues --> Orchestrator reviews --> Fixer diagnoses & fixes --> QA re-verifies
                       |
                      +------+------+
                      v RE-VERIFY   v
                      | Fixer rebuilds |
                      | + re-lints     |
                      | -> re-smoke    |
                      | -> re-verify   |
                      +------+------+
```

### 9-Step Feedback Loop Protocol

1. **QA/Verifier Reports**: Returns detailed report with issues
2. **Orchestrator Reviews**: Orchestrator reads the report and inspects relevant code
3. **Orchestrator Delegates to Fixer**: Sends bug report + context + plan manifest to Fixer
4. **Fixer Diagnoses**: Fixer uses high reasoning effort to trace root cause
5. **Fixer Applies Fix**: Minimal targeted fix, no scope creep
6. **Fixer Builds & Lints**: Build and lint MUST pass
7. **Orchestrator Re-invokes QA**: Sends QA back to verify the fix
8. **After QA passes**: Re-invoke Verifier to check against plan manifest
9. **Loop Repeats**: Continue until all gates pass or escalation threshold reached

### Escalation Criteria

If the same issue resurfaces after **3 Fixer attempts**, escalate back to PlanDescriber for roadmap revision.

### Context Preservation

When cycling back to Fixer, use `task_id` (ses_xxx) to preserve conversation context with the prior Fixer session so the agent retains memory of what it diagnosed.

---

## Escalation

| Threshold | Action |
|-----------|--------|
| Same bug reappears after 3 Fixer attempts | Escalate to PlanDescriber for roadmap revision |
| Same agent fails consecutively 3 times | Orchestrator pauses that agent path and reviews manually |
| Verifier score < 80% after 3 Fixer re-verification failures | Escalate to PlanDescriber for roadmap revision |
| Security Scan fails 3 times | Escalate to user for direction |
| Total pipeline retries across all gates exceed 5 | Orchestrator pauses and reports to user |

---

## Root Cause Classifier

### Taxonomy

| Category | Definition | Example | Escalation Path |
|----------|-----------|---------|----------------|
| **plan-omission** | The plan didn't specify this behavior | "Plan had no checkpoint for handling duplicate email" | Escalate to PlanDescriber after 2nd occurrence |
| **implementation-error** | The code doesn't match the plan spec | "Method signature doesn't match plan" | Fix and continue in current pipeline |
| **edge-case-miss** | The plan covered it but the implementation missed an edge case | "Function works for valid input but fails on empty string" | Fix and add test for edge case |
| **integration-mismatch** | Two modules don't agree on interface | "Service returns User but controller expects UserDTO" | Fix the interface contract |
| **environment-issue** | Build/lint/tooling problem | "TypeScript strict mode catches type error that wasn't in plan" | Fix config or code |

### Fixer Classification → Error Code Mapping

| Fixer Classification | Mapped Error Code |
|---------------------|-------------------|
| plan-omission | PLN-001 or PLN-002 |
| implementation-error | IMP-001, IMP-002, or IMP-003 |
| edge-case-miss | IMP-004 or IMP-005 |
| integration-mismatch | INT-001, INT-002, or INT-003 |
| environment-issue | ENV-001, ENV-002, or ENV-003 |

---

## Fix Confidence Score

| Score | Meaning | Description |
|-------|---------|-------------|
| 8-10 | Highly confident | Fix addresses root cause, cross-module check passed |
| 5-7 | Moderately confident | Fix addresses symptoms, root cause may be deeper |
| 1-4 | Low confidence | Fix is a workaround, root cause may be elsewhere |

### Cross-Module Check

After applying a fix, the Fixer reports:

- **Cross-module check**: Did the fix break anything in other modules?
  - Use `grep` to find files that import/modify the same symbols
  - Run affected module's tests if available
  - Report: "Cross-module check: [module X] unaffected, [module Y] may need review"