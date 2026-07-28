---
name: openspec-spec
description: >-
  Spec-driven development stage that creates, reads, updates, and archives
  OpenSpec specification artifacts (proposal, specs, design, tasks) before
  planning begins. Uses the OpenSpec CLI (@fission-ai/openspec) to manage
  the spec lifecycle. Specs are persistent Markdown documents with
  GIVEN/WHEN/THEN scenarios that live in the repository as the source of
  truth for system requirements. The spec-writer agent handles CRUD
  operations, the user reviews and approves specs before planning, and
  QA validates implementation against spec scenarios at verification time.
  Triggers on: "spec", "specification", "openspec", "spec-driven",
  "requirements", "proposal", "scenarios", "GIVEN/WHEN/THEN",
  "spec review", "spec gate", "spec validation".
  Use when the pipeline needs a spec-first stage where requirements are
  captured as living documentation before decomposition into implementation
  checkpoints. Do NOT use for simple single-step tasks or when the user
  already has a clear, detailed plan ready.
allowed-tools: Bash(*) task(*) question(*) read(*) write(*) edit(*) glob(*) grep(*)
---
# OpenSpec Spec Stage

This skill defines the spec-driven development stage that sits between **Explore Context** and **Plan** in the development pipeline. It uses the [OpenSpec CLI](https://openspec.dev) to create and manage specification artifacts.

## Prerequisites

Before the first use, ensure OpenSpec CLI is installed and the project is initialized:

```bash
npm install -g @fission-ai/openspec@latest
cd <project-root>
openspec init
```

The `openspec init` command creates the `openspec/` folder structure:
```
openspec/
├── specs/              # Your specifications (source of truth)
├── changes/            # Proposed changes
└── config.yaml         # Project configuration
```

## Capabilities

| Capability | Description | Command |
|---|---|---|
| **Create** | Scaffold a new change with proposal, specs, design, and tasks | `openspec new change <name>` then generate artifacts via the spec-writer agent |
| **Read / Show** | Display a change's artifacts (proposal, specs, design, tasks) | `openspec show <change-name>` or `openspec show <change-name> --json` |
| **List** | List all active changes and specs | `openspec list` or `openspec list --specs` |
| **Update** | Revise a change's planning artifacts and keep them coherent | `openspec update <change-name>` (via `/opsx:update` equivalent) |
| **Validate** | Check changes and specs for structural issues | `openspec validate <change-name>` or `openspec validate --all --json` |
| **Status** | Display artifact completion status for a change | `openspec status --change <name> --json` |
| **Verify** | Validate implementation matches spec scenarios | Manual review of tasks, requirements, and scenarios |
| **Archive** | Finalize a completed change, merge delta specs into main specs | `openspec archive <change-name>` |

## Spec Artifacts

Each change creates a folder under `openspec/changes/<change-name>/` with these artifacts:

| Artifact | File | Purpose |
|---|---|---|
| **Proposal** | `proposal.md` | Why we're doing this, what's changing, goals |
| **Specs** | `specs/<area>/spec.md` | Requirements with GIVEN/WHEN/THEN scenarios (the source of truth) |
| **Design** | `design.md` | Technical approach, architecture decisions, trade-offs |
| **Tasks** | `tasks.md` | Implementation checklist with checkboxes |

### Spec Format

Specs use plain Markdown with GIVEN/WHEN/THEN scenarios:

```markdown
# <feature> Specification

## Purpose
Brief description of what this spec covers.

## Requirements

### Requirement: <requirement name>
The system SHALL <behavior description>.

#### Scenario: <scenario name>
- GIVEN <initial context>
- WHEN <action occurs>
- THEN <expected outcome>
```

## Spec Stage Workflow

### Step 1: Create Spec Change

The spec-writer agent creates a new OpenSpec change:

1. Run `openspec new change <feature-name>` to scaffold the change folder
2. Generate the **proposal** — describe why and what
3. Generate the **specs** — requirements with GIVEN/WHEN/THEN scenarios
4. Generate the **design** — technical approach and decisions
5. Generate the **tasks** — implementation checklist

### Step 2: Present for User Review

Present the spec artifacts to the user for review:
- Show the proposal (what and why)
- Show the specs (requirements and scenarios)
- Show the design (technical approach)
- Show the tasks (implementation checklist)

Use the `question` tool with these options:
- **"Approve"** — specs are ready, proceed to planning
- **"Revise"** — let the user describe changes, then update artifacts
- **"Cancel"** — discard the change and stop

### Step 3: Revise if Needed

If the user requests changes:
1. Update the affected artifacts (proposal, specs, design, tasks)
2. Re-present for review
3. Loop until approved or cancelled

### Step 4: Hand Off to Planner

Once approved, pass the spec artifacts to the planner agent. The planner reads the specs and derives plan-protocol checkpoints and acceptance criteria from the spec requirements and scenarios.

## Spec Validation at QA Time

During the QA Verification Gate (step 13 of the pipeline), the QA agent performs manual spec verification by reviewing tasks, requirements, and scenarios:

This validates three dimensions:
- **Completeness** — all tasks done, all requirements implemented, scenarios covered
- **Correctness** — implementation matches spec intent, edge cases handled
- **Coherence** — design decisions reflected in code, patterns consistent

## Hard Rules

- MUST ensure OpenSpec CLI is installed before attempting any spec operations
- MUST run `openspec init` in the project root before creating changes
- MUST present spec artifacts to the user for review before proceeding to planning
- MUST NOT proceed to planning if the user rejects or cancels the spec
- MUST update artifacts in-place when the user requests revisions (not recreate from scratch)
- MUST pass the change name and spec file paths to the planner agent
- MUST perform manual spec verification during QA to validate implementation against spec scenarios
- MUST run `openspec archive` at the end of the pipeline to finalize the change
- MUST use `--json` flag for agent-consumable output from CLI commands
- MUST prefer the OpenSpec CLI for spec operations; fall back to direct editing only when the CLI cannot handle the operation

## References

- `agents/spec-writer.md` — The spec-writer agent that executes this skill
- `skills/plan-protocol/SKILL.md` — Plan creation skill that consumes spec artifacts
- `agents/qa.md` — QA agent that runs `openspec verify` at verification time
- `skills/development-full-workflow/SKILL.md` — The parent pipeline that includes this stage
- OpenSpec CLI docs: https://openspec.dev
- OpenSpec GitHub: https://github.com/Fission-AI/OpenSpec
