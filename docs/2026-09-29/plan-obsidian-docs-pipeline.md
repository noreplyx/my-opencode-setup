---
type: plan
date: "2026-09-29"
created: "2026-09-29T00:00"
status: approved
tags: [plan, approved]
related: ["[[2026-09-29/decision-obsidian-docs-pipeline]]", "[[2026-09-29/adr-001-obsidian-docs-pipeline]]"]
slug: "obsidian-docs-pipeline"
---

# Plan: Obsidian docs pipeline

> Date: `2026-09-29` | Status: `approved` on Stage 3 sign-off
> Daily hub: `[[daily/2026-09-29]]`

## Goal

Write approved plans, decisions, and ADRs into `docs/` as an Obsidian vault, date-separated.

## Scope

In: vault scaffold, templates, doc-writer agent, Stage 3/6 hooks. Out: retroactive migration of old docs.

## Constraints

On approval only; `YYYY-MM-DD/` folders; full Nygard ADR; full `.obsidian/` setup.

## Design recap

Day folder + daily hub + Dataview index; doc-writer subagent scoped to `docs/**`.

## Plan steps

| Step | Action | Files | Criterion |
| ---- | ------ | ----- | --------- |
| 1 | Scaffold `.obsidian/` | `docs/.obsidian/*` | DOC-01 |
| 2 | Add templates | `docs/templates/*` | DOC-04 |
| 3 | Add index + daily | `docs/_index.md`, `docs/daily/*` | DOC-06 |
| 4 | Add doc-writer | `agent/doc-writer.md` | DOC-05 |
| 5 | Hook orchestrator | `agent/code-orchestrator.md` | DOC-02 |

## Links

- Decision: `[[2026-09-29/decision-obsidian-docs-pipeline]]`
- ADR: `[[2026-09-29/adr-001-obsidian-docs-pipeline]]`
- Daily: `[[daily/2026-09-29]]`
