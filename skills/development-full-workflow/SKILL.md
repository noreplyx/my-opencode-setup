---
name: development-full-workflow
description: >-
  Full development workflow orchestrator skill that coordinates the complete
  multi-agent pipeline: clarify scope, explore context, plan, parallel review
  (security/engineer/architecture/qa), consolidate feedback, plan review gate,
  user approval gate, implement, lint gate, test gate, security scan gate, QA
  verification gate, and final report. This skill is automatically loaded by the
  Orchestrator agent at the start of every pipeline. It defines the exact
  13-step workflow, conflict resolution rules, remediation loops, gate
  sequencing, and verdict taxonomy usage. Use when the Orchestrator is running
  a full development pipeline that requires structured planning, multi-reviewer
  gates, sequential quality gates (lint -> test -> security -> QA), and
  comprehensive reporting. Also use when the user asks for a "full workflow",
  "development pipeline", "multi-agent workflow", "orchestrated development",
  or "complete implementation process" with planning, review, implementation,
  and verification phases.
allowed-tools: Bash(*) task(*) question(*) webfetch(*) searxng(*) github(*) clickup(*) sql-reader(*) redis(*)
---

# Development Full Workflow

This skill defines the complete 13-step development pipeline used by the Orchestrator agent. It coordinates a team of specialized subagents to deliver high-quality, secure, well-architected, and tested code.

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

Collect all four review verdicts and apply priority-based conflict resolution:

**Priority hierarchy (highest to lowest):** Security > Architecture > Engineer > QA
- Security `reject` — overrides all other verdicts (safety-critical issues must be resolved first)
- Architecture `reject` — overrides Engineer and QA (structural issues are expensive to fix later)
- Engineer `reject` — overrides QA (engineering quality is foundational)
- QA `reject` — lowest priority (testability can be improved after structural/engineering issues)

**Conflict detection:** For each pair of reviewers, if a higher-priority reviewer returns `reject` and a lower-priority one returns `pass`, flag the conflict and document why the higher-priority verdict prevails.

**Same-level conflicts:** If two reviewers at the same priority level disagree (e.g., both are reviewers with equal standing), escalate to the user with both positions documented.

**Output:** A consolidated feedback report that:
- Lists all four verdicts in priority order
- Flags any conflicts between reviewers
- States the final gating decision with rationale
- Documents dissenting opinions for the final report

Return the consolidated report to the `planner` agent to update the plan.

### Step 6: Plan Review Gate

Confirm the plan has passed review using the consolidated verdict. All reviewer verdicts use the unified taxonomy in `VERDICT-TAXONOMY.md`. Apply the priority hierarchy: if the highest-priority reviewer that returned a verdict other than `not-applicable` returned `reject`, send the plan back to the `planner` for another iteration. If all reviewers return `pass`, `pass-with-concerns`, or `not-applicable`, the plan is ready for user review. Surface any `pass-with-concerns` items and any documented conflicts in the final report.

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

Delegate to the `coder` agent with the approved plan. The coder implements the code and runs relevant tests and scans.

### Step 9: Lint Gate

Delegate to the `linter` agent to detect and run the project's local linter. Wait for a clear verdict.

**Remediation:** If the `linter` agent returns `reject`, route the plan and findings back to the `planner` agent. Then return to step 8 (coder fixes the issues) and re-run this gate. Allow up to **2 remediation loops**; if `reject` persists, stop and escalate to the user.

### Step 10: Test Gate

Only after the lint gate passes, delegate to the `tester` agent to run the project's local tests and verify acceptance-criterion coverage. Wait for a clear verdict.

**Remediation:** If the `tester` agent returns `reject`, route the plan and findings back to the `planner` agent. Then return to step 8 (coder fixes the issues), re-run step 9 (lint gate), and re-run this gate. Allow up to **2 remediation loops**; if `reject` persists, stop and escalate to the user.

### Step 11: Security Scan Gate

Only after the test gate passes, delegate to the `security` agent to analyze the diff, select applicable scanners based on changed files, run them, and perform a mandatory manual security code review of all changed files. Wait for a clear verdict.

**Remediation:** If the `security` agent returns `reject`, route the plan and findings back to the `planner` agent to add mitigations/update acceptance criteria. Then return to step 8 (coder re-implements the fix), re-run step 9 (lint gate), re-run step 10 (test gate), and re-run this gate. Allow up to **2 remediation loops**; if `reject` persists, stop and escalate to the user.

### Step 12: Verify (QA Verification Gate)

Only after the security scan gate passes, delegate to the `qa` agent to verify the implemented code against the plan and acceptance criteria. The QA agent will run the automated coverage verification script as part of its workflow.

**Remediation:** If the `qa` agent returns `reject`, route the findings back to the `planner` agent to update the plan. Then return to step 8 (coder implements the fixes), re-run step 9 (lint gate), re-run step 10 (test gate), re-run step 11 (security scan), and re-run this gate. Allow up to **2 remediation loops**; if `reject` persists, stop and escalate to the user.

### Step 13: Report

Return a concise final summary to the user: what was done, key decisions, risks, lint results, test results (including coverage percentage from the automated verification), security scan results, QA verdict, any `pass-with-concerns` items raised at each gate, any documented reviewer conflicts, and next steps.

## Rules

- Always use the `task` tool to delegate to other agents. Give each agent a complete, self-contained prompt.
- Do not implement code yourself unless an agent is unavailable.
- Preserve the user's original wording and intent when delegating.
- When the `coder` agent returns an unapproved plan, route it back to the `planner` agent with the reason.
- Always obtain explicit user approval (step 7) before proceeding to implementation. The auto-advance rule does not apply to the user approval gate.
- Do **not** advance to the `test` gate until the `lint` gate has passed.
- Do **not** advance to the `security` scan gate until the `test` gate has passed.
- Do **not** advance to the `qa` final verification step until the `security` scan gate has passed.
- Do **not** report final success until the `qa` verification step has passed.
- Track remediation loops independently: the lint, test, security, and QA gates each have their own 2-loop budget. If any gate repeatedly returns `reject`, escalate to the user rather than looping indefinitely.

## References

- `VERDICT-TAXONOMY.md` — Shared verdict vocabulary (`pass`, `pass-with-concerns`, `reject`, `not-applicable`)
- `scripts/verify-plan-coverage.ts` — Coverage verification script for test gate
- `agents/orchestrator.md` — The orchestrator agent that loads this skill
- `skills/plan-protocol/SKILL.md` — Plan creation skill used by the planner agent

