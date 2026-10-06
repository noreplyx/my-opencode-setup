# Explainer HTML docs (`docs/plans/`)

Reusable template: `_explainer-template.html` — top nav + single centered column (max 800px).

## Use
```bash
cp docs/plans/_explainer-template.html docs/plans/<topic>.html
python3 -m http.server
# open http://localhost:8000/docs/plans/<topic>.html
```

## Fill order
1. Replace every `REPLACE-THIS-TOPIC` and `REPLACE-THIS-path.ts`.
2. Extend `STRINGS.en` / `STRINGS.th` together — keep keys stable, no parallel-DOM.
3. Keep sections 1-8 in order; if purely explanatory, turn Rollout into Key takeaways.
4. Every diagram needs a 2-sentence caption; every section opens with 2-3 sentence narrative intro.
5. Code identifiers stay English; translate only the surrounding prose.

## Built-ins (do not remove)
- Theme: `explainer-theme` + `prefers-color-scheme` live-follow, `[data-theme]` CSS vars, toggle in header. D3 (`renderD3()`) re-renders on toggle; fills/strokes from CSS vars only.
- Lang: `explainer-lang` + `navigator.language` sniff, `data-i18n` + `setLang()`, `EN|ไทย` toggle next to theme toggle. D3 labels come from `data-d3` JSON blocks (`en`/`th`) and re-render on `setLang()`.
- TOC anchors + scrollspy + progress, copy buttons, `<details>` FAQs, tabs, before/after slider (`#ba-range`), live filter (`#filter`), stepper SVG (`#stepsvg`), D3 flow (`#d3-flow` via `renderD3Flow`) + sequence (`#d3-seq` via `renderD3Sequence`).
- CDN allowlist: `cdn.tailwindcss.com` (layout utilities only, colors via vars) + `d3@7` (`cdn.jsdelivr.net/npm/d3@7`). No local deps. No Mermaid.

## Checks before delegating back
```bash
tidy -errors -q docs/plans/<topic>.html
python3 -c "import html.parser" # parse smoke
rg -n "REPLACE-THIS" docs/plans/<topic>.html  # must be empty when done
rg -in "mermaid" docs/plans/<topic>.html agent/explainer.md docs/plans/_explainer-template.html  # must be empty (D3-only)
rg -n "d3.min.js|renderD3|data-d3" docs/plans/<topic>.html  # must be non-empty
```
