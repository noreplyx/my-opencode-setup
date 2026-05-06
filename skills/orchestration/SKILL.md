---
name: orchestration
description: Use this skill to orchestrate multiple agents to resolve complex problems and achieve overarching goals.
---

## Core Principles

### 1. Multi-Agent Orchestration
- **Goal Decomposition**: Break high-level goals into specific, actionable tasks suitable for specialized agents.
- **Agent Assignment**: Match tasks to the most appropriate agents (e.g., Finder for research, Orchestrator for brainstorming with user, Planner for roadmaps, Implementor for code).
- **Workflow Sequencing**: Define the order of operations, ensuring agents receive the necessary context and outputs from previous steps.

### 2. Task Management
- **Clear Instruction**: Provide each agent with explicit objectives, constraints, and expected output formats.
- **Output Validation**: Review results from each agent before proceeding to the next stage of the workflow. Use read/glob/grep to inspect files produced by agents.
- **Inter-Agent Coordination**: Manage the hand-off of data and state between different agents to maintain project consistency.

### 3. Result Validation
- **Cross-Agent Verification**: Use a QA agent to validate that the combined output of multiple agents solves the original complex problem.
- **Iterative Refinement**: Cycle back to previous agents if validation reveals gaps or errors in the implementation.

## Standard Workflow Pipeline

The default orchestration workflow follows this sequence:

```
1. FINDER ──► Explore codebase, gather context, research dependencies
          │
2. ORCHESTRATOR ──► Brainstorm with user interactively, explore ideas, converge on direction
          │
3. PLAN DESCRIBER ──► Create detailed, step-by-step implementation roadmap
          │              └── Also produces plan-manifest.json for verification
          │
4. IMPLEMENTOR ──► Write code strictly following the plan
          │
   ┌──────┴──────┐
   ▼ BUILD CHECK ▼ (MANDATORY)
   │  Implementor MUST run build │
   │  and return full build output│
   └──────┬──────┘
          │ (build fails → Implementor fixes, rebuilds)
          ▼
   ┌──────┴──────┐
   ▼ LINT GATE   ▼ (MANDATORY if linter configured)
   │  Implementor MUST run linter │
   │  (eslint, prettier --check,  │
   │   tsc --noEmit, etc.)        │
   └──────┬──────┘
          │ (lint fails → Implementor fixes, re-lints)
          ▼
5. QA ──► Test, validate, report results
          │
   ┌──────┴──────┐
   ▼ SMOKE TEST  ▼
   │ QA runs smoke test to │
   │ confirm app is runnable│
   └──────┬──────┘
          │
6. VERIFIER ──► Compare implementation against plan manifest
          │        └── Structural checks (Pass 1)
          │        └── Behavioral checks (Pass 2)
          │        └── Produces compliance score + deviation report
          │
   ┌──────┴──────┐
   ▼ FAILURE     ▼ (score < 80% → Orchestrator reviews, may cycle back to Implementor)
   │ Escalate to │
   │ Orchestrator│
   └──────┬──────┘
          │
7. ORCHESTRATOR ──► Review all results, report to user
```

### When to Skip Steps
- **Simple/familiar tasks**: Skip Finder, go directly to PlanDescriber → Implementor → QA.
- **Exploratory/research tasks**: Use only Finder, report findings directly to user.
- **Bug fixes (known root cause)**: Skip PlanDescriber, go directly to Implementor for the fix, then QA, then Verifier.

### Build Gate & Smoke Test Requirements

Every implementation MUST pass through two mandatory validation gates:

| Gate          | Who Runs It  | What It Checks                                          | Failure Action                            |
|---------------|--------------|---------------------------------------------------------|-------------------------------------------|
| **Build Gate**   | Implementor  | Code compiles without errors (e.g., `npm run build`, `tsc`) | Implementor fixes and rebuilds before proceeding |
| **Lint Gate**    | Implementor  | Code passes linter/style checks (e.g., `eslint`, `prettier --check`, `tsc --noEmit`) | Implementor fixes lint errors before proceeding |
| **Smoke Test**   | QA           | Application boots/starts without crashing, or module loads cleanly | QA reports as Critical bug; Orchestrator cycles back to Implementor for fixes |
| **Plan Verify**  | Verifier     | Code matches plan-manifest.json checkpoints (structural + behavioral) | Score < 80% → Orchestrator reviews; may cycle back to Implementor or PlanDescriber |

**Build Gate Protocol:**
- The Implementor MUST run the build command after writing code
- The Implementor MUST return the full build output (stdout + stderr) to the Orchestrator
- If the build fails, the Implementor MUST fix the issue and rebuild before reporting completion
- The Orchestrator MUST inspect the build output to confirm success before proceeding to QA

**Smoke Test Protocol:**
- QA MUST run a simple smoke test (build is already verified by Implementor's Build Gate)
- The smoke test should be fast (< 10 seconds) and provide high confidence the application is runnable
- If the smoke test fails, QA reports it as a Critical severity bug
- The Orchestrator reviews the report and cycles back to Implementor for fixes
- After fixes, QA re-runs the smoke test (build is re-verified by Implementor)

**Lint Gate Protocol:**
- The Implementor MUST run lint commands (e.g., `eslint`, `prettier --check`, `tsc --noEmit`) after the build passes
- The Implementor MUST return the full lint output (stdout + stderr) to the Orchestrator
- If linting fails, the Implementor MUST fix the issues and re-lint before reporting completion
- The Orchestrator MUST inspect the lint output to confirm no errors before proceeding to QA
- If the project has no linter configured, the Implementor should report "No linter configured" and proceed
- The Implementor's report MUST include lint output alongside build output so the Orchestrator can confirm both gates passed

## Agent Hand-off Protocol

### Hand-off Checklist
When passing work from one agent to the next, the Orchestrator MUST include:

1. **Context Summary**: What was done in the previous step(s)
2. **Artifacts**: Relevant file paths, outputs, or data produced
3. **Clear Objective**: Exactly what the next agent should do
4. **Constraints**: Any boundaries, rules, or restrictions
5. **Expected Output**: What the agent should return/report

### Example Hand-off
```
Orchestrator to PlanDescriber:
"After brainstorming with the user, we've agreed on Option B (modular monolith approach).
Finder has analyzed the codebase (see files: src/services/user.ts, src/models/user.ts).
Please create a detailed implementation roadmap for adding user profile management,
following the code-philosophy and backend-code-philosophy skills.
Focus on: data models, service layer, and API endpoints."
```

### Verifier Hand-off
When passing from QA to Verifier, include:
1. **Plan Manifest Path**: Path to the `plan-manifest.json` file produced by PlanDescriber
2. **Implementation Summary**: Brief summary of what was implemented
3. **QA Results**: Summary of QA's smoke test and any bug reports
4. **Clear Objective**: "Verify that the implementation matches all structural and behavioral checkpoints in the plan manifest"
5. **Expected Output**: Compliance score, pass/fail/skipped breakdown, deviation report

Example:
```
Orchestrator to Verifier:
"The plan manifest is at plan-manifests/user-profile-manifest.json.
Implementation added UserService with createUser and getUser methods.
QA smoke test passed.
Please verify all checkpoints in the manifest and report the compliance score."
```

## QA Feedback Loop

When QA discovers bugs or issues, use this iterative refinement cycle:

```
QA reports bugs ──► Orchestrator reviews ──► Implementor applies fixes ──► QA re-verifies
```

### Feedback Loop Protocol
1. **QA Reports**: QA returns detailed bug report with steps to reproduce, expected vs actual, severity
2. **Orchestrator Reviews**: Orchestrator reads the bug report and inspects relevant code (using read/glob/grep)
3. **Orchestrator Delegates to Implementor**: Sends bug report + context back to Implementor with instructions to fix
4. **Implementor Fixes**: Applies the fix following the bug report specifications
5. **Orchestrator Re-invokes QA**: Sends QA back to verify the fix
6. **Loop Repeats**: Continue until QA passes or escalation threshold reached

### Escalation Criteria
If the same bug resurfaces after 3 fix attempts, escalate back to PlanDescriber for roadmap revision.

### Context Preservation
When cycling back to Implementor, use `task_id` (ses_xxx) to preserve conversation context with the prior subagent session so the agent retains memory of the code it wrote.

## Output Verification
- **Inspect produced files**: Use read/glob/grep to verify that agents created/modified the expected files correctly.
- **Cross-reference with plan**: Compare actual implementation against the original roadmap to ensure completeness.
- **Check for side effects**: Verify that changes didn't unintentionally modify unrelated files or introduce inconsistencies.

## Orchestrator as Brainstormer

The Orchestrator serves as the **primary brainstorming partner** for the user. This is by design:

### Why the Orchestrator handles brainstorming
- **Real-time interaction**: The Orchestrator can have a live back-and-forth conversation with the user
- **Immediate iteration**: Ideas can be explored, rejected, or refined on the fly
- **Context retention**: The Orchestrator holds all project context and can connect brainstorming to execution seamlessly

### Workflow
1. Orchestrator brainstorms **interactively** with the user
2. Orchestrator formalizes the plan and proceeds to delegation

## Agent Timeout & Circuit Breaker

### Timeout Policy
- Each agent task should complete within a reasonable timeframe
- The Orchestrator monitors task duration and may abort tasks that exceed expected time
- If a subagent times out, the Orchestrator restarts the task with a fresh agent session
- Repeated timeouts (> 2) for the same task indicate a deeper issue — escalate to PlanDescriber

### Circuit Breaker Pattern
The system includes a circuit breaker to prevent infinite agent loops:

| State | Meaning | Action |
|---|---|---|
| **Closed** | Normal operation | Agents execute as normal |
| **Open** | Repeated failures detected | Orchestrator pauses cycling to the same agent for the same issue |
| **Half-Open** | Probation period | Orchestrator allows one retry to test if the issue is resolved |

### Escalation Limits
- **Same bug reappears**: 3 fix attempts → escalate to PlanDescriber for roadmap revision
- **Same agent fails consecutively**: 3 failures → Orchestrator pauses that agent path and reviews manually
- **Verifier score < 80%**: 3 re-verification failures → escalate to PlanDescriber for roadmap revision
- **Total pipeline retries**: If total retries across all gates exceed 5, Orchestrator pauses and reports to user

### Circuit Breaker Workflow
```
1. Agent task fails (build, lint, smoke test, or verification)
2. Orchestrator records the failure in a counter for that specific check
3. If counter < threshold (3), Orchestrator cycles back for retry
4. If counter >= threshold, Orchestrator opens the circuit:
   a. Pauses further retries for that specific check
   b. Escalates to PlanDescriber if the root cause is plan-related
   c. Reports to user with failure summary and escalation decision
5. After PlanDescriber revises the plan, Orchestrator resets the circuit (Half-Open)
6. One retry is allowed — if it passes, circuit closes; if it fails, circuit opens again
```

### Counter Reset
- Circuit breaker counters are reset when:
  - The task passes the gate successfully
  - PlanDescriber revises the roadmap
  - The Orchestrator manually resets after user intervention

