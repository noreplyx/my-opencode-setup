---
title: "Vault home"
date: "2026-09-29"
type: hub
status: approved
tags: [hub]
related: ["[[2026-09/2026-09-hub]]"]
slug: "home"
diagrams: []
---

# Vault home

This folder (`docs/`) is an Obsidian vault. Open it directly in Obsidian. No community plugins required.

## L1 — Start here (plain links, no plugins needed)

- Current month hub: `[[2026-09/2026-09-hub|September 2026 hub]]`
- Current month canvas: `[[2026-09/canvas/2026-09-Overview.canvas|September overview canvas]]`
- Templates: `[[Templates/plan-template|plan]]`, `[[Templates/decision-template|decision]]`, `[[Templates/adr-template-nygard|ADR]]`, `[[Templates/monthly-overview-template|monthly overview]]`
- Validators: `[[Validators/vault-checklist|vault checklist]]`
- Legacy index (frozen history): `[[_index]]`

## L2 — Indexes (Dataview, with fallback)

> Dataview blocks below require the Dataview community plugin (install + enable manually). Without it they render as code — use the L1 links and the month hub instead.

```dataview
TABLE type, status, date FROM "2026-09" SORT file.name DESC LIMIT 20
```

```dataview
TABLE status, date FROM "2026-09" AND #adr SORT date DESC LIMIT 20
```

Fallback: browse `[[2026-09/2026-09-hub|September 2026 hub]]`; tags `#plan` `#decision` `#adr` work in core search/graph without plugins.

## L3 — Bases (optional)

No `.base` view is shipped (optional per design). To add one, create `2026-09/2026-09.base` in Obsidian via "Create new base" filtered to folder `2026-09`; it is additive and never required.
