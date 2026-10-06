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
- Theme: `explainer-theme` + `prefers-color-scheme` live-follow, `[data-theme]` CSS vars, toggle in header. Mermaid re-renders on toggle.
- Lang: `explainer-lang` + `navigator.language` sniff, `data-i18n` + `setLang()`, `EN|ไทย` toggle next to theme toggle.
- TOC anchors + scrollspy + progress, copy buttons, `<details>` FAQs, tabs, before/after slider (`#ba-range`), live filter (`#filter`), stepper SVG (`#stepsvg`).
- CDN allowlist: `cdn.tailwindcss.com` (layout utilities only, colors via vars) + `mermaid@10`. No local deps.

## Checks before delegating back
```bash
tidy -errors -q docs/plans/<topic>.html
python3 -c "import html.parser" # parse smoke
rg -n "REPLACE-THIS" docs/plans/<topic>.html  # must be empty when done
```
