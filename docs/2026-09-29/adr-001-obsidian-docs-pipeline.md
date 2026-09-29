---
type: adr
date: "2026-09-29"
created: "2026-09-29T00:00"
status: accepted
tags: [adr, accepted]
adr: "001"
supersedes: []
superseded-by: []
related: ["[[2026-09-29/plan-obsidian-docs-pipeline]]", "[[2026-09-29/decision-obsidian-docs-pipeline]]"]
slug: "obsidian-docs-pipeline"
---

# ADR-001: Obsidian docs pipeline

- Status: `accepted` (on Stage 6 sign-off)
- Date: `2026-09-29`
- Deciders: orchestrator + user (Stage 3 / Stage 6 approvals)

## Context

Plans and decisions lived only in chat transcripts. Need date-separated, linkable record that renders in Obsidian with graph, backlinks, and Dataview.

## Decision

Use `docs/` as vault root with `YYYY-MM-DD/` day folders, `daily/YYYY-MM-DD.md` hubs, checked-in `.obsidian/`, templates for plan/decision/Nygard ADR/daily, and an approval-gated `doc-writer` subagent invoked at Stage 3 (plan+decision) and Stage 6 (ADR + flip to approved).

## Consequences

Positive: browsable history, stable links, no draft spam. Negative: extra writes per run, ADR counter needs serialization. Risks mitigated by serial delegation and minimal `.obsidian/` keys.

## Alternatives considered

- Type-first layout — rejected: poor daily review.
- Single daily file — rejected: ADR length.
- Auto-write every run — rejected: noise; approval-only adopted.

## Links

- Plan: `[[2026-09-29/plan-obsidian-docs-pipeline]]`
- Decision: `[[2026-09-29/decision-obsidian-docs-pipeline]]`
- Daily: `[[daily/2026-09-29]]`
