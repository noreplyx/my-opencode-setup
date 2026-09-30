---
title: "Monthly overview template"
date: "{{date:YYYY-MM}}"
type: hub
status: draft
tags: [hub, template]
related: []
slug: "<YYYY-MM>"
diagrams: []
---

# {{date:YYYY-MM}} overview

> Month bucket: `[[{{date:YYYY-MM}}/{{date:YYYY-MM}}-hub|month hub]]` | Canvas: `[[{{date:YYYY-MM}}/canvas/{{date:YYYY-MM}}-Overview.canvas|overview canvas]]`
> Dataview blocks require the Dataview community plugin (manual install). Fallback: hand-maintained lists below.

## TL;DR

- Verdict: <month in one line>.
- Action: <what needs approval>.
- Pointer: <key note>.

## Notes this month (fallback, no plugin needed)

- Plan: `[[{{date:YYYY-MM}}/{{date:YYYY-MM-DD}}-<slug>-plan]]`
- Decision: `[[{{date:YYYY-MM}}/{{date:YYYY-MM-DD}}-<slug>-decision]]`
- ADR: `[[{{date:YYYY-MM}}/{{date:YYYY-MM-DD}}-<slug>-adr-NNN]]`

```dataview
TABLE type, status, date FROM "{{date:YYYY-MM}}" SORT file.name
```

## Canvas

- Overview: `[[{{date:YYYY-MM}}/canvas/{{date:YYYY-MM}}-Overview.canvas|overview canvas]]`

## Assets

- `[[{{date:YYYY-MM}}/assets/<name>.svg|diagram sidecar]]` — embedded in the relevant note with caption + text fallback.

## Links

- Home: `[[Home]]`

## Draft checklist

- [ ] Fallback link list matches the bucket contents
- [ ] Canvas nodes resolve to existing notes
- [ ] Every SVG sidecar is embedded by at least one note
