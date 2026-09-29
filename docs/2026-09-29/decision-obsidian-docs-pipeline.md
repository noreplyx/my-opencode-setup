---
type: decision
date: "2026-09-29"
created: "2026-09-29T00:00"
status: approved
tags: [decision, approved]
related: ["[[2026-09-29/plan-obsidian-docs-pipeline]]", "[[2026-09-29/adr-001-obsidian-docs-pipeline]]"]
slug: "obsidian-docs-pipeline"
---

# Decision: Obsidian docs pipeline

> Date: `2026-09-29` | Status: `approved`
> Daily hub: `[[daily/2026-09-29]]`

## Context

Need durable, browsable record of approved plans/decisions/ADRs inside `docs/` without polluting code reviews.

## Options considered

- **Option 1 — YYYY-MM-DD folders (adopted)**: one folder per day holding plan/decision/ADR. Pros: sorts, isolates days. Cons: extra dirs.
- **Option 2 — Type then date prefix**: `plans/YYYY-MM-DD-x.md`. Rejected: flat dirs grow, harder daily review.
- **Option 3 — Daily note + embeds**: single file per day. Rejected: unwieldy for long ADRs.

## Decision

Adopt Option 1 with `daily/YYYY-MM-DD.md` hub + Dataview, full `.obsidian/` vault, Nygard ADR, write on approval only.

## Consequences

Graph-friendly history; no draft noise; requires doc-writer serialization for ADR counter.

## Links

- Plan: `[[2026-09-29/plan-obsidian-docs-pipeline]]`
- ADR: `[[2026-09-29/adr-001-obsidian-docs-pipeline]]`
- Daily: `[[daily/2026-09-29]]`

## Canonical contract (verbatim)

```text
Goal: Persist approved AI-agent outputs as Obsidian notes
Scope: docs/ vault, date folders, plan/decision/ADR
Constraints: Approval-gated, wikilinks + frontmatter, Nygard ADR
Inputs: User request: Obsidian vault docs pipeline, date-separated
Expected output: Vault scaffold + templates + doc-writer + hooks
Completion criteria: DOC-01..DOC-07 pass
Risks/ambiguities: Obsidian version drift, ADR counter races
```
