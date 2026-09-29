# Vault home

This folder (`docs/`) is an Obsidian vault. Open it directly in Obsidian.

> Dataview blocks below require the Dataview community plugin (install + enable manually). Without it they render as code — use the plain fallback links instead.

- Daily hubs: `daily/YYYY-MM-DD.md`
- Day artifacts: `YYYY-MM-DD/plan-<slug>.md`, `decision-<slug>.md`, `adr-NNN-<slug>.md`
- Templates: `templates/`
- Existing: `ai-agent-pipeline.md`, `orchestrator-review-hybrid34.md`, `reviews/`

## Recent days

```dataview
TABLE date, length(file.inlinks) AS links FROM "daily" SORT file.name DESC LIMIT 20
```

## All ADRs (Nygard)

```dataview
TABLE status, date FROM #adr SORT date DESC
```

## All decisions

```dataview
TABLE status, date FROM #decision SORT date DESC
```

## All plans

```dataview
TABLE status, date FROM #plan SORT date DESC
```

## Fallback (no Dataview)

- Browse `daily/` for day hubs, or `YYYY-MM-DD/` folders directly.
- Tags `#plan` `#decision` `#adr` work in core search/graph without plugins.
