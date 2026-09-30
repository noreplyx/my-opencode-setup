# Vault checklist (runnable)

Run: `bash docs/Validators/check.sh` from the repo root (stdlib only: `bash` + `python3`, no installs).
It checks every month bucket (`docs/YYYY-MM/` via glob) plus `docs/Home.md` and `docs/Templates/`;
legacy folders (`docs/daily/`, `docs/2026-09-29/`, `docs/templates/`) are read-only history and out of scope.

| # | Check | How |
| --- | --- | --- |
| 1 | YAML frontmatter parses on every note | `check.sh` → frontmatter block between leading `---` lines parses as `key: value` with required keys `title,date,type,status,tags,related,slug` (+ `adr,supersedes,superseded-by` when `type: adr`) |
| 2 | Wikilinks resolve (live notes; `Templates/` scaffolds carry `<slug>`/`{{date}}` placeholders and are frontmatter-only) | every `[[target\|alias]]` / `[[target]]` resolves note-relative first (containing note dir), then `docs/`-root fallback (tries `target`, `target.md`) |
| 3 | Mermaid lint | fenced `mermaid` bodies start with allowlist (`flowchart`, `sequenceDiagram`, `classDiagram`, `stateDiagram-v2`, `erDiagram`, `gantt`); no `%%{init}` JS |
| 4 | SVG exists + embed resolves | every `![](...svg)` / `[[...svg]]` points at an existing file (note-relative first, vault-root fallback); every `assets/*.svg` is embedded by ≥ 1 note |
| 5 | No absolute paths | no `](/`, `](C:`, `](/home`, `](file://` links; no `/home/`, `/Users/`, `C:\` literals in notes |
| 6 | Orphan both directions | no dangling wikilink targets; every in-scope note has ≥ 1 inlink or is an entry point (`Home.md`, every `*-hub.md`, `Templates/*`) |
| 7 | Canvas JSON parses + nodes/edges validate | `*.canvas` is valid JSON; every `type: file` node `file` resolves under `docs/`; edge endpoints reference existing node ids; node/edge ids unique; node `x`/`y` numeric; canvas upserts match nodes by `file` |
| 8 | Stage 6 triple status agreement + ADR uniqueness | plan/decision/ADR sharing one `date`+`slug`: accepted ADR implies approved plan+decision and vice versa; no two files share one ADR NNN (frontmatter `adr` or `-adr-NNN` filename) |
| 9 | TL;DR budget (KD-05) | every `## TL;DR` section holds at most 5 bullets AND at most 60 words |
| 10 | Month rollover integrity | note folder name equals `date[0:7]` inside month buckets; cross-month links error except to `Home.md` and legacy paths |

Mermaid note: the lint is syntactic (allowlist + init-ban), not a full render; open the month canvas + notes in Obsidian with plugins disabled for visual confirmation.

## VLT mapping (DoD VLT-01..VLT-15)

| VLT | Criterion | Evidence |
| --- | --- | --- |
| VLT-01 | Vault opens cleanly in Obsidian, no plugins required | human: open `docs/` per `Home.md` L1 |
| VLT-02 | Monthly bucket layout `docs/YYYY-MM/` | check 10 folder/date agreement |
| VLT-03 | Month hub with fallback link lists | check 6 hub is an entry point; hub links resolve per check 2 |
| VLT-04 | `Templates/` scaffolds for plan/decision/ADR/hub | templates in scope, placeholders rewritten per `agent/doc-writer.md` rollover rule |
| VLT-05 | Frontmatter schema complete | check 1 |
| VLT-06 | SVG sidecars embedded by notes | check 4 |
| VLT-07 | Validators runnable stdlib-only | `bash docs/Validators/check.sh` exits PASS |
| VLT-08 | Canvas overview parses and resolves | check 7 |
| VLT-09 | Mermaid allowlist, no JS init | check 3 |
| VLT-10 | No dangling links | checks 2 + 4 |
| VLT-11 | No absolute paths | check 5 |
| VLT-12 | No orphans except entry points | check 6 |
| VLT-13 | Readability: TL;DR budget + caption/fallback | check 9 (budget); captions/fallbacks human per template checklists |
| VLT-14 | Approval-gated pipeline writes only | `agent/doc-writer.md` timing gates + check 8 status agreement |
| VLT-15 | Legacy frozen read-only | legacy paths out of scope above; validator flags edits only via scope exclusion |
