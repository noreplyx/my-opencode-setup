---
type: daily
date: "{{date:YYYY-MM-DD}}"
tags: [daily-note]
---

# {{date:YYYY-MM-DD}}

> Day hub for plans, decisions, ADRs. Day folder: `{{date:YYYY-MM-DD}}/`
> Dataview blocks require the Dataview community plugin (manual install). Fallback: list notes below by hand.

## Notes today

```dataview
TABLE type, status FROM "{{date:YYYY-MM-DD}}" SORT file.name
```

- Plan: `[[{{date:YYYY-MM-DD}}/plan-<slug>]]`
- Decision: `[[{{date:YYYY-MM-DD}}/decision-<slug>]]`
- ADR: `[[{{date:YYYY-MM-DD}}/adr-NNN-<slug>]]` (after Stage 6)

## All ADRs

```dataview
TABLE status, date FROM #adr SORT date DESC
```

## Links

- Vault home: `[[_index]]`
