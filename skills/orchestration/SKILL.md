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
3. BRAINSTORMER (optional) ──► Deep-dive analysis on specific approaches (invoked by Orchestrator if needed)
          │
4. PLANNER ──► Create detailed, step-by-step implementation roadmap
          │
5. IMPLEMENTOR ──► Write code strictly following the plan
          │
6. QA ──► Test, validate, report results
          │
7. ORCHESTRATOR ──► Review results, report to user
```

### When to Skip Steps
- **Simple/familiar tasks**: Skip Finder and Brainstormer, go directly to Planner → Implementor → QA.
- **Exploratory/research tasks**: Use only Finder, report findings directly to user.
- **Bug fixes (known root cause)**: Skip Planner, go directly to Implementor for the fix, then QA.

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
Orchestrator to Planner:
"After brainstorming with the user, we've agreed on Option B (modular monolith approach).
Finder has analyzed the codebase (see files: src/services/user.ts, src/models/user.ts).
Please create a detailed implementation roadmap for adding user profile management,
following the code-philosophy and backend-code-philosophy skills.
Focus on: data models, service layer, and API endpoints."
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
If the same bug resurfaces after 3 fix attempts, escalate back to Planner for roadmap revision.

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
- **Efficiency**: Avoids slow round-trips of User → Orchestrator → Brainstormer → Orchestrator → User

### Workflow
1. Orchestrator brainstorms **interactively** with the user
2. Once direction is agreed upon, Orchestrator may optionally invoke the **Brainstormer subagent** for deep-dive analysis
3. Orchestrator formalizes the plan and proceeds to delegation

### When to use the Brainstormer subagent
- Comparing multiple architectural approaches in detail
- Generating comprehensive pro/con lists
- Exploring edge cases or niche scenarios
- Producing structured analysis documents
