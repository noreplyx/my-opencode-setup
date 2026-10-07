# Explainer HTML docs (`docs/plans/`)

Reusable template: `_explainer-template.html` — 1100px shell with sticky sidebar TOC + 760px reading column (drawer on mobile).

## Use
```bash
cp docs/plans/_explainer-template.html docs/plans/<topic>.html
python3 -m http.server
# open http://localhost:8000/docs/plans/<topic>.html
```

## Fill order
1. Replace every `REPLACE-THIS-TOPIC` and `REPLACE-THIS-path.ts`.
2. Extend `STRINGS.en` / `STRINGS.th` together — keep keys stable, no parallel-DOM.
3. Keep sections 1-8 in order; if purely explanatory, turn Rollout into Key takeaways. Add 9-11 by rule: §9 Self-check + Try-it when core has 3+ steps or code changes (quiz via `checkQuiz` + lab block `code-tryit`), §10 Troubleshooting when flow lists 2+ error paths, §11 Glossary + Further reading by default unless <3 jargon terms. Omit non-fitting ones with a one-sentence justification.
4. Pick diagrams by topic: flow/sequence by default; uncomment `visual-data` (ER via `renderD3ER`) when 2+ stored entities exist, `visual-actors` (use-case via `renderD3Usecase`) when actors + goals exist, `visual-arch` (C4 via `renderD3C4`, C1/C2/C3 switcher) when architecture exists, `visual-ui` (screen gallery + required Wide/Medium/Narrow breakpoint cards + state table) when 2+ screens, a journey, or interactive states exist. For UI topics wireflow reuses `renderD3Flow` with screen nodes; screenshots go in `docs/plans/assets/<topic>-<screen>.png` (relative paths, max 6 shots, each under 500KB). Omit non-fitting ones.
5. Every diagram and every screen needs a 2-sentence caption (what it shows + what to notice); every section opens with 2-3 sentence narrative intro. Every `<img>` needs `alt` + `data-i18n-alt`; breakpoint cards are 3 separate `.card` blocks, never one `<p>` with 3 bolds.
6. Code identifiers stay English; translate only the surrounding prose. PK/FK, cardinality (`1`, `0..*`), `<<include>>`/`<<extend>>`, and C4 stereotypes (`person|system|container|component|db`) stay English.

## Built-ins (do not remove)
- Theme: `explainer-theme` + `prefers-color-scheme` live-follow, `[data-theme]` CSS vars, toggle in header. D3 (`renderD3()`) re-renders on toggle; fills/strokes from CSS vars only.
- Lang: `explainer-lang` + `navigator.language` sniff, `data-i18n` + `data-i18n-alt` (for `<img>`) + `setLang()`, `EN|ไทย` toggle next to theme toggle. D3 labels come from `data-d3` JSON blocks (`en`/`th`) and re-render on `setLang()`.
- TOC anchors + scrollspy + progress (sidebar `#toc` vertical + `.toc-mobile` drawer, incl. `#tryit/#troubleshoot/#glossary`), copy buttons (incl. `code-tryit`), `<details>` FAQs, tabs (group-scoped: `t-flow/t-compare/t-table` + `t-screen1/t-screen2`), before/after slider (`#ba-range`, supports code panes and `<img>`), live filter (`#filter`), stepper SVG (`#stepsvg`), quiz (`#quiz-check` via `checkQuiz` + `#quiz-result` live region), D3 flow (`#d3-flow` via `renderD3Flow`, also used for UI wireflows) + sequence (`#d3-seq` via `renderD3Sequence`) + optional ER (`#d3-er` via `renderD3ER`) + use-case (`#d3-uc` via `renderD3Usecase`) + C4 (`#d3-c4` via `renderD3C4`, `data-c4-level` c1/c2/c3) + UI shots (`.shot` + `.screen-grid` breakpoint cards).
- CDN allowlist: `cdn.tailwindcss.com` (layout utilities only, colors via vars) + `d3@7` (`cdn.jsdelivr.net/npm/d3@7`). No local deps except `docs/plans/assets/*.png` screenshots for UI topics. No Mermaid.

## Checks before delegating back
```bash
tidy -errors -q docs/plans/<topic>.html
python3 -c "import html.parser" # parse smoke
rg -n "REPLACE-THIS" docs/plans/<topic>.html  # must be empty when done
rg -in "mermaid" docs/plans/<topic>.html agent/explainer.md docs/plans/_explainer-template.html  # must be empty (D3-only)
rg -n "d3.min.js|renderD3|data-d3" docs/plans/<topic>.html  # must be non-empty
rg -n "renderD3ER|renderD3Usecase|renderD3C4" docs/plans/_explainer-template.html  # must be non-empty (helpers present)
```
