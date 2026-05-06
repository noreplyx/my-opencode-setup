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

## Dynamic Skill Learning

The system can learn new skills from user conversations. When the user discusses a pattern, principle, or methodology, the Orchestrator can save it as a reusable skill.

### Learn Skill Workflow

When the user wants to save a discussion topic as a skill, use this pipeline:

```
User discusses a pattern/principle
        │
        ▼
Orchestrator brainstorms with user
        │  ──► Confirms: "Would you like to save this as a skill?"
        │  ──► Gets user approval and skill name
        ▼
SkillScribe distills conversation
        │  ──► Creates .agents/skills/<name>/SKILL.md
        │  ──► Registers in .agents/skills/skills-registry.json
        ▼
Implementor updates agent permissions
        │  ──► Edits implementor.md permission whitelist
        │  ──► Edits plandescriber.md permission whitelist (if applicable)
        │  ──► Edits qa.md permission whitelist (if applicable)
        ▼
QA validates
        │  ──► SKILL.md follows correct format
        │  ──► Registry is valid JSON
        │  ──► Agent configs valid YAML frontmatter
        ▼
Orchestrator reports to user
        ──► "Skill '<name>' is now available to all agents"
```

### Hand-off to SkillScribe

When delegating to SkillScribe, include:

1. **Conversation Summary**: What was discussed (principles, patterns, rules)
2. **Skill Name**: The desired skill name (kebab-case)
3. **Skill Description**: A one-line description
4. **Expected Output**: SKILL.md file and registry update

Example:
```
Orchestrator to SkillScribe:
"We discussed idempotency patterns for payment processing. Key points:
- Use Idempotency-Key headers on all mutating endpoints
- Store processed keys with status + response in Redis with TTL
- Return cached response for duplicate keys
- Never reprocess a duplicate request

Please save this as skill 'idempotency-patterns'."
```

### Permission Update Protocol

After SkillScribe creates the skill, the Orchestrator delegates to Implementor to:

1. Read the current agent config file (e.g., `agents/subagent/implementor.md`)
2. Add `"<new-skill-name>": "allow"` to the `permission.skill` block
3. Repeat for other agents if the skill applies (plandescriber, qa, etc.)
4. Verify the YAML frontmatter is still valid

### Registry Maintenance

- `skills/skills-registry.json` is the source of truth for all skills
- The Orchestrator can read this file to discover available skills
- Skills with `builtIn: true` are system-provided and should not be modified
- Skills with `builtIn: false` are learned from conversations and can be updated or removed

## Audit Logging

All agents MUST log their actions to `logs/agent-audit.log` for traceability.

### Audit Log Location
- **File**: `logs/agent-audit.log` (in the workspace root)
- **Format**: Plain text, one entry per line
- **Log Rotation**: Not configured — file grows indefinitely (manual cleanup)

### Standard Log Entry Format

```
[TIMESTAMP] AGENT=<agent-name> | TASK=<task-description> | FILES=<affected-files> | STATUS=<success|failure> | DURATION=<seconds>s
```

### Fields
| Field       | Description                                         |
|-------------|-----------------------------------------------------|
| TIMESTAMP   | Date and time in ISO-like format (YYYY-MM-DD HH:MM:SS) |
| AGENT       | Name of the agent (implementor, skillscribe, qa, etc.) |
| TASK        | Short description of what was done                  |
| FILES       | Comma-separated list of affected file paths         |
| STATUS      | `success` or `failure`                              |
| DURATION    | Approximate time taken in seconds                   |

### Enforcement
- The Orchestrator MAY read the audit log to review agent activity
- Missing audit entries are not a blocker — but agents SHOULD log whenever practical
- Log entries are append-only — never modify or delete existing entries

