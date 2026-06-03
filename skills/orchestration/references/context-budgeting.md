# Context Budgeting

## Progressive Summarization

As the pipeline progresses, summarize older agent outputs:

| Step | After Completion | Summarize What | Target Length |
|---|---|---|---|
| Finder → PlanDescriber | Finder output | Full exploration report | 3-5 bullet points |
| PlanDescriber → Implementor | PlanDescriber output | Full roadmap | 3-5 sentence summary + manifest path |
| Implementor → QA | Implementor output | Build/lint output | "Build passed" or "Build failed: [key errors only]" |
| QA → Verifier | QA output | Bug report + edge case findings | "2 bugs found (1 critical, 1 minor)" |
| Verifier → Orchestrator | Verifier output | Full deviation report | "3 deviations: CP-003, CP-007, CP-012" |

Store summaries in `agent-context.md` under `summaries` field.

## How to Use

- Orchestrator uses summaries (not raw output) for context.
- Full raw output stored in agentHistory for debugging.
- When Fixer cycle-backs, give them FULL context of their own previous attempt + summaries of everything else.

## Granular Archival Strategy

| Pipeline Step | What's Retained | What's Summarized | What's Archived |
|---|---|---|---|
| Steps 1-3 | Full context | Nothing | Nothing |
| Steps 4-5 | Full for current + summaries for past | Finder, Brainstorm | Raw → `.opencode/pipeline-logs/` |
| Steps 6+ | Summary only for steps 1-3 | PlanDescriber, Implementor | Archived |
| Fixer loop | Fixer's own FULL context | Everything before Fixer | Archived |
| Verifier | Verifier (full) + latest Fixer (full) | Steps before fix cycle | Archived |

## Per-Agent Context Filtering

| Agent Receiving | Gets | Doesn't Get |
|---|---|---|
| PlanDescriber | Finder's knowledge graph + decisions | Full Finder report, old manifests |
| Implementor | Plan roadmap + manifest + git state | QA/Verifier reports |
| Integrator | All files from parallel Implementors + wiring conventions | Finder logs, brainstorm notes |
| Fixer (1st) | Bug/Verifier report + manifest + changed files | Full QA output, other builds |
| Fixer (cycle-back) | Same + own rootCauseAnalysis + CB state | Everything else |
| QA | Plan summary + changed files + build/lint | Finder, brainstorm, manifest details |
| Verifier | Manifest + implementation summary + build/lint + acceptance criteria | Finder, brainstorm |
| Documentor | Git diff + QA report + manifest summary | Full QA/Verifier breakdown, CB state |
| Security Scan | Project type + lockfile + source dirs + SAST rules | Everything else |
| Browser Tester | Routes/changed UI + app URL | Plan details, QA internals |