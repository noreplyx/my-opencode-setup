---
name: development-full-workflow
description: >-
  Full development workflow orchestrator skill that coordinates the complete
  multi-agent pipeline: clarify scope, explore context, plan, parallel review
  (security/engineer/architecture/qa), consolidate feedback, plan review gate,
  user approval gate, implement, lint gate, test gate, security scan gate, QA
  verification gate, and final report. This skill is automatically loaded by the
  Orchestrator agent at the start of every pipeline. It defines the exact
  11-step workflow, conflict resolution rules, remediation loops, gate
  sequencing, and verdict taxonomy usage. Use when the Orchestrator is running
  a full development pipeline that requires structured planning, multi-reviewer
  gates, parallel quality gates (lint || test, then security || QA), and
  comprehensive reporting. Also use when the user asks for a "full workflow",
  "development pipeline", "multi-agent workflow", "orchestrated development",
  or "complete implementation process" with planning, review, implementation,
  and verification phases.
allowed-tools: Bash(*) task(*) question(*) webfetch(*) searxng(*) github(*) clickup(*) sql-reader(*) redis(*)
---

# Development Full Workflow

This skill defines the complete 11-step development pipeline used by the Orchestrator agent. It coordinates a team of specialized subagents to deliver high-quality, secure, well-architected, and tested code.

## Workflow (execute in order)

### Step 1: Clarify Scope

If the user's request is vague, delegate to the `brainstormer` agent to gather requirements and present 2-4 solution options for the user to choose from. Wait for the brainstormer's verdict:
- `pass` — collect the selected option and requirements summary
- `reject` — inform the user that no decision was reached and ask them to pick an approach or provide more direction before proceeding
- `not-applicable` — proceed directly to step 2

### Step 2: Explore Context

Delegate to the `code-explorer` agent to explore the codebase, gather relevant files, conventions, and constraints. Collect a concise context summary.

### Step 3: Plan

Delegate to the `planner` agent to create a structured plan following the `plan-protocol` skill, using the gathered requirements and context.

### Step 4: Parallel Review

Launch concurrent tasks to all four reviewers:
- `security` — review the plan for security concerns and mitigations
- `engineer` — review for engineering best practices, performance, and maintainability
- `architecture` — review for system architecture fit, trade-offs, ADRs/C4 diagrams if needed
- `qa` — review for testability, acceptance criteria, and verification approach

Wait for all four feedback items.

### Step 5: Consolidate Feedback with Conflict Resolution

Collect all four review verdicts and apply equal-weight conflict resolution:

**Equal-weight conflict resolution:** All four reviewers have equal standing. Any single `reject` blocks the plan — no reviewer's verdict overrides another's.

**Conflict detection:** If any reviewer returns `reject` and another returns `pass`, flag the conflict. Since all reviewers are equal, a single `reject` always prevails regardless of which reviewer issued it.

**Output:** A consolidated feedback report that:
- Lists all four verdicts
- Flags any conflicts between reviewers
- States the final gating decision with rationale
- Documents dissenting opinions for the final report

Return the consolidated report to the `planner` agent to update the plan.

### Step 6: Plan Review Gate

Confirm the plan has passed review using the consolidated verdict. All reviewer verdicts use the unified taxonomy in `VERDICT-TAXONOMY.md`. Apply the equal-weight rule: if **any** reviewer returned `reject`, send the plan back to the `planner` for another iteration. If all reviewers return `pass`, `pass-with-concerns`, or `not-applicable`, the plan is ready for user review. Surface any `pass-with-concerns` items and any documented conflicts in the final report.

### Step 7: User Approval Gate

Present the reviewed plan to the user with a comprehensive summary:
- List each checkpoint with its acceptance criteria
- Summarize pros/cons from all reviewer feedback
- Surface any `pass-with-concerns` items and notices from security/engineer/architecture/qa

Use the `question` tool with these options (the "Type your own answer" option must always be present):
- **"Approve"** — proceed to implementation (continue to step 8)
- **"Change"** — let the user type free-form modifications, then route back to the `planner` agent to update the plan and re-run the review cycle
- **"Cancel"** — stop the workflow and report to the user
- **"Type your own answer"** — let the user type anything; interpret their response and act accordingly (e.g., if they type approval text, treat as approve; if they type modifications, route to planner)

Do **not** proceed to implementation until the user selects "Approve".

### Step 8: Implement

Delegate to the `coder` agent with the approved plan. The coder implements the code and runs relevant tests and scans. For plans with independent checkpoints, the coder may dispatch parallel sub-coder tasks to implement multiple checkpoints concurrently.

### Step 9: Lint/TypeCheck + Test Gates (Parallel Pair 1)

Launch the `linter` agent (which returns both lint and typecheck verdicts) and the `tester` agent **concurrently** in a single message (parallel tool calls). The linter agent covers two gates (lint + typecheck); the tester agent covers the test gate. These three gates are independent — failures in one do not affect the others.

**Lint Gate** — Delegate to the `linter` agent to detect and run the project's local linter. Wait for a clear verdict.

**TypeCheck Gate** — Delegate to the `linter` agent with instructions to run the project's type checker (e.g., `tsc --noEmit`, `mypy`, `cargo check`, `gotype`, etc.) as a separate step after linting. The linter agent will detect the type checker from project manifests and run it. Wait for a clear verdict.

**Test Gate** — Delegate to the `tester` agent to run the project's local tests. Wait for a clear verdict.

Wait for all three gates to return before proceeding.

**Remediation (all three gates):**
- If **only the lint gate** returns `reject`: route the plan and findings back to the `planner` agent. Then return to step 8 (coder fixes the issues) and re-run **only the lint gate** (step 9a). The typecheck and test gate results are preserved — do not re-run them.
- If **only the typecheck gate** returns `reject`: route the plan and findings back to the `planner` agent. Then return to step 8 (coder fixes the issues), re-run **all three** gates (lint, typecheck, test) — lint and test must re-run because code changed.
- If **only the test gate** returns `reject`: route the plan and findings back to the `planner` agent. Then return to step 8 (coder fixes the issues), re-run **all three** gates (lint, typecheck, test) — lint and typecheck must re-run because code changed.
- If **two or more gates** return `reject`: route the plan and findings back to the `planner` agent. Then return to step 8 (coder fixes the issues) and re-run all three gates (step 9).
- Allow up to **2 remediation loops per gate** (tracked independently across lint, typecheck, and test). If any gate persists in rejecting after its 2-loop budget, stop and escalate to the user.

### Step 10: Security Scan + QA Verification Gates (Parallel Pair 2)

Only after **all three** of the lint, typecheck, and test gates have passed (step 9), launch **both** the `security` and `qa` agents **concurrently** in a single message (parallel tool calls). These two gates are independent — security vulnerabilities do not affect AC coverage and vice versa.

**Security Scan Gate** — Delegate to the `security` agent to analyze the diff, select applicable scanners based on changed files, run them, and perform a mandatory manual security code review of all changed files. Wait for a clear verdict.

**QA Verification Gate** — Delegate to the `qa` agent to verify the implemented code against the plan and acceptance criteria. The QA agent will run `scripts/verify-plan-coverage.ts` as part of its workflow to produce an objective coverage baseline.

Wait for both gates to return before proceeding.

**Remediation (both gates):**
- If **only the security gate** returns `reject`: route the plan and findings back to the `planner` agent to add mitigations/update acceptance criteria. Then return to step 8 (coder re-implements the fix), re-run step 9 (lint, typecheck, and test gates), and re-run **only the security gate** (step 10a). The QA gate result is preserved — do not re-run it.
- If **only the QA gate** returns `reject`: route the findings back to the `planner` agent to update the plan. Then return to step 8 (coder implements the fixes), re-run step 9 (lint, typecheck, and test gates), and re-run **only the QA gate** (step 10b). The security gate result is preserved — do not re-run it.
- If **both gates** return `reject`: route the plan and findings back to the `planner` agent. Then return to step 8 (coder fixes the issues), re-run step 9 (lint, typecheck, and test gates), and re-run both gates (step 10).
- Allow up to **2 remediation loops per gate** (tracked independently). If either gate persists in rejecting after its 2-loop budget, stop and escalate to the user.

### Step 11: Report

Return a concise final summary to the user: what was done, key decisions, risks, lint results, test results (including coverage percentage from the automated verification), security scan results, QA verdict, any `pass-with-concerns` items raised at each gate, any documented reviewer conflicts, and next steps.

## Rules

- Always use the `task` tool to delegate to other agents. Give each agent a complete, self-contained prompt.
- Do not implement code yourself unless an agent is unavailable.
- Preserve the user's original wording and intent when delegating.
- When the `coder` agent returns an unapproved plan, route it back to the `planner` agent with the reason.
- Always obtain explicit user approval (step 7) before proceeding to implementation. The auto-advance rule does not apply to the user approval gate.
- Launch lint, typecheck, and test gates **concurrently** (parallel pair 1). Wait for all three to finish before proceeding.
- Launch security scan and QA verification gates **concurrently** (parallel pair 2). Wait for both to finish before proceeding.
- Do **not** advance to parallel pair 2 (security + QA) until **all three** gates in parallel pair 1 (lint + typecheck + test) have passed.
- Do **not** report final success until **both** gates in parallel pair 2 (security + QA) have passed.
- Track remediation loops independently: each of the 5 gates (lint, typecheck, test, security, QA) has its own 2-loop budget. If any gate repeatedly returns `reject`, escalate to the user rather than looping indefinitely.
- When remediating a single gate failure, preserve the passing results of its parallel partners (do not re-run the passing gates) unless code changes were made that could affect them.

## References

- `VERDICT-TAXONOMY.md` — Shared verdict vocabulary (`pass`, `pass-with-concerns`, `reject`, `not-applicable`)
- `scripts/verify-plan-coverage.ts` — Coverage verification script for test gate
- `agents/orchestrator.md` — The orchestrator agent that loads this skill
- `skills/plan-protocol/SKILL.md` — Plan creation skill used by the planner agent

