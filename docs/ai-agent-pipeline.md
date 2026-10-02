# AI Agent Pipeline — Gate-Hardened Spec (v1)

Doc home: `docs/ai-agent-pipeline.md`. No application-runtime changes; adds a
test-time arbiter module under `scripts/**`.

## 1. Canonical contract (seven fields, preserved verbatim)

Every handoff carries: Goal, Scope, Constraints, Inputs, Expected output,
Completion criteria, Risks/ambiguities. Field names are stable; never rename
or omit. `Inputs` preserves the user original: "review these AI agent
pipeline." Approved Option 2 + design v1 govern this revision.
Secret redaction rule: when echoing handoffs, redact secrets/credentials/tokens
(API keys, passwords, private keys); never echo secret values verbatim — replace
with `[REDACTED]` and note the redaction.

## 2. Stages, roles, handoffs

| Stage | Owner → Next | Entry gate | Exit gate |
|---|---|---|---|
| 1 Brainstorm | brainstormer → orchestrator | Goal + constraints present | Decision + requirements handoff, options converged |
| 2 Plan | code-planner → orchestrator | Stage 1 handoff verbatim | Design doc v1 + DoD AC-01..AC-28 + files-to-touch |
| 2.5 Triage | orchestrator | Design doc present | Routing decision recorded (full / fast-track / stop) |
| 3 Approval | user (question tool) | Design + plan table + tradeoffs presented | Explicit approve / request-changes |
| 4 Implement | coder → orchestrator | Approved design + active checklist verbatim | Criterion-to-change/evidence mapping |
| 4.5 Verify | verifier (independent) | Coder handoff + DoD verbatim | Verdict pass (+ evidence per criterion); fail blocks Stage 5 |
| 5 Review loop | reviewers + scanner → coder → verifier | Verified diff + latest design | No Critical/Major, code-reviewer clean, verify pass, sign-offs recorded |
| 6 Sign-off | user (question tool) | Diff + verdicts + residuals presented | Approve-and-finish or request-changes |
| 7 VCS (opt-in) | vcs-committer | Stage 6 approval + explicit VCS request | `vcs: done <sha>` / `denied` / `not-taken` |

### 2.1 Stage 5 steps (step-7 defined)

Stage 5 runs steps 1–7 in order: 1) scanner pass, 2) reviewers pass,
3) severity triage, 4) remand to coder with fix instructions, 5) coder rework,
6) verifier re-verification, 7) cap/escalation check — at the outer-pass cap
(≤ 2) escalate to the user for decision (fix / accept residual / kill) instead
of looping; below the cap, return to step 1 for the next outer pass.

The stage is hardened for determinism: the pipeline freezes `reviewed_sha` as a
content digest of the artifact under review (`git status --porcelain -uall` plus
`git diff HEAD` plus every untracked file's content, with `git rev-parse HEAD`
auxiliary) on the first Stage 4.5/5 call and passes it to every parallel reviewer
and scanner. `-uall` keeps `--porcelain` from collapsing a new directory to one
path and the per-path content keeps an untracked Stage 5 artifact inside the
freeze. The digest is SHA-1-based (`git hash-object --stdin`), so it resists
accidental drift, not a cryptographic adversary; the authoritative check is the
frozen raw-payload byte-compare, with the numeric digest auxiliary. Findings merge on
`fingerprint` only, normalized before max-severity collapse, then advance the
ledger (`agent/finding-schema.md`, `scripts/review-ledger.mjs`). The ledger
update receives the exact object `{reportedCategories: [...]}` naming the
categories that reported this round (scanner-only `dependency`/`secret` included
only when that leg ran), so a tiered re-verify cannot mark un-run categories'
findings `fixed`; a malformed scope fails closed. Re-verification is
tiered — touched-category lenses for an ordinary fix, all lenses plus the
scanner for a large or security-sensitive diff — and cheap legs run first; the
stateless scanner is passed the run's `mode: full|delta` explicitly. A
secret finding (`category: secret`, `incident: true`, any severity) takes the
incident path (rotate/purge + `.scans/` ignore), never the coder loop.

## 3. Validators per gate (pass / remand / kill)

Each gate has a validator: entry-check → verdict `pass` (advance), `remand`
(return to owner with fix instructions, counts toward caps), `kill`
(terminate per K-criteria). Validators: Stage 1 convergence check,
Stage 2 design completeness, Stage 2.5 triage eligibility,
Stage 3 approval response, Stage 4 mapping completeness,
Stage 4.5 independent verification, Stage 5 severity gate (fingerprint merge
and ledger per `agent/finding-schema.md`), Stage 6 residual acceptance. Every
validator verdict is logged with stage,
verdict, reason, and timestamp; the log is carried in the handoff to the next
stage. Approval timeout / stalled rule: if Stage 3 or Stage 6 approval is not
received within the agreed window (default 48h) or the checkpoint stalls with
no owner activity, the validator issues `remand` to the orchestrator for
escalation/nudge; two consecutive stalls trigger K2 (cap exhausted without user
decision). Remand payload rule: each remand carries fix instructions verbatim
plus owner, stage, and cap-count reference.

## 4. Loop guards / caps

Plan rounds ≤ 2. Implement-Verify rounds ≤ 3. Review outer passes ≤ 2
(Stage 5 step-7 escalation at cap; user decides). Cap counting rule: caps count
validator `remand` verdicts per loop (plan rounds, implement-verify rounds,
review outer passes); `pass` and terminal `kill` do not consume the cap.
Remand-count clarification: each `remand` verdict increments exactly one
applicable cap counter once. Design-conflict re-issues
count as one pass each. Caps force escalate, never silent stop.

Loop budget is counted as **agent calls + scanner minutes**, not only passes,
calibrated in `scripts/review-ledger.mjs` (`DEFAULT_LOOP_BUDGET`) to the ≤ 2
outer-pass cap: `agentCalls` counts one per subagent delegation (~9 per pass —
scanner, five reviewers, code-reviewer, coder, verifier — × 2 passes = 18
nominal), and `scannerMinutes` sums the five scan legs' own reported
`started_at`/`finished_at` durations (~15 per pass × 2 passes = 30). The
`agentCalls` cap is set strictly above the 18 nominal two-pass total (19) so it
is an independent overflow backstop and cannot fire at the same instant as the
≤ 2 outer-pass cap. An unreported `spent` counter falls back to `0`, never to
the pass count. The
orchestrator carries one accumulated state object
`{passes, spent: {agentCalls, scannerMinutes}, nonConvergentRounds,
regressionRounds, designConflictReissues}`, incrementing `agentCalls` once per
subagent delegation, `regressionRounds` once per finding that regresses, and
`designConflictReissues` once per design-conflict re-issue, while adding each
scan leg's reported duration to
`scannerMinutes`. Before each loop it calls `shouldEscalate(state)` and
escalates when it returns `true`; `shouldEscalate` is enforced by the loop, not
by a runtime (the orchestrator is `edit`/`bash` deny), so it is advisory only —
enforced by the loop, not a runtime. Divergence escalation triggers when open Critical/Major counts
are non-decreasing across rounds (a held or rising count after 2 rounds), when
any finding regresses twice, or when design-conflict re-issues repeat. Finding
churn (opened/fixed/regressed/recurring)
and design-conflict churn (re-issues/re-approvals) are tracked as **separate
counters** and never summed.

## 5. Triage routing (Stage 2.5)

Full pipeline by default. Fast-track only when triage eligible (see §7);
otherwise full. No-op/stop when no change needed, with user confirm
("stop here, or force implementation?"). Trivial quick-confirm still runs
Stage 4.5 + 5 + 6. Triage closure note: every triage routing decision is
recorded with rationale and closed explicitly (routed / stopped) — no routing
left open or implicit.

## 6. Kill criteria K1–K5

K1: unverifiable DoD without sign-off path. K2: cap exhausted without user
decision. K3: design contradiction unresolvable by revision. K4: security
Critical unfixable within approved architecture. K5: user stop / approval
withdrawn. K4 carries a **secret-incident halt** sub-clause: a live secret (`category:
secret`, `incident: true`, **any severity** — Critical in practice for
Gitleaks/Trivy) halts the coder loop and routes to the incident path
(rotate/purge + `.scans/` ignore) rather than an implementation fix. Kill is terminal with recorded reason; reversible
only via new pipeline run.

## 7. Fast-track lane + denylist

Fast-track skips Stage 3 full review via quick-confirm only. Denylist
(always full pipeline): auth, crypto, secrets handling, parsing, public-API
changes. Fast-track requires `auto_approve: false` default; this spec sets
risk `medium`, `auto_approve: false`, so fast-track is closed for this
revision — consistent by construction.

## 8. Reversible gates

All gates reversible: remand returns to owner; re-approval restores prior
design version (superseded text annotated, never deleted); no destructive
advance. Stage 7 VCS is opt-in only.

## 9. Stable IDs

DoD IDs AC-01..AC-28 stable. AC-11 is amended **in place** under the same ID;
withdrawn marked with reason; new IDs (AC-12+) continue numbering, never
renumber.

## 10. Risk / auto_approve

Risk: medium. `auto_approve: false`. Consistent: no Stage 2.5 skip, no
fast-track, full Stage 3 + 6 checkpoints required. Approval lock: any change
to `auto_approve` requires explicit Stage 3 or Stage 6 user approval before
taking effect; the pipeline never flips it silently.

## 11. DoD AC-01..AC-28

AC-01 seven fields echoed. AC-02 entry/exit all stages. AC-03 validator per
gate. AC-04 max rounds stated. AC-05 triage routing. AC-06 K1–K5.
AC-07 fast-track denylist. AC-08 reversible. AC-09 stable IDs.
AC-10 risk/auto_approve consistent. AC-11 (amended in place) scope discipline
holds: changes land only under `agent/**`, `docs/**`, `scripts/**`, `tests/**`,
verified by `git status --short` + `git diff --stat` showing only allowlisted
paths changed/untracked. `plugins/`, `mcp/`, `opencode.jsonc`, `src/`,
`tools/`, and unrelated application code remain excluded from this DoD
(separate changeset); no application-runtime changes — the `scripts/**` arbiter
is test-time only.
AC-12 finding schema normative (`agent/finding-schema.md`): 8 fields, closed
8-value enum, fingerprint formula, slug grammar, severity anchors,
evidence-else-Nit, `incident` marker. AC-13 six reviewers + scanner reference
the schema, emit a fenced JSON block, state the closed enum. AC-14
`fingerprint` pure/deterministic, excludes `line`, equals
`category/rule_id/file#symbol` after normalization. AC-15 merge keyed on
`fingerprint` only; cross-category same-line stays 2; duplicates collapse to 1
at max normalized severity. AC-16 one rubric; normalization before max-severity
collapse. AC-17 ledger states open/fixed/regressed/recurring/accepted +
per-round counts; monotonic non-increasing open Critical/Major. AC-18
`docs/review-baseline.json` schema-valid; match suppresses; lifts on
touched-file/expiry/severity-mismatch; `pruneBaseline` drops only expired
entries and preserves the `{version, entries}` wrapper. AC-19 scanner per-leg `mode: full|delta` +
`rule_pack_digest`; history scanners once per run. AC-20 every finding needs
proof; no evidence → Nit. AC-21 tiered reverify. AC-22 secret finding (any
severity) → incident path, never coder loop. AC-23 `not-verifiable` causes classify and map
bijectively to routes; coverage-delta/mutation where tooling exists. AC-24
divergence escalation + loop budget + separate churn counters. AC-25 content
freeze digest (`git status --porcelain -uall` + `git diff HEAD` plus every
untracked file's content, `git rev-parse HEAD`
auxiliary) passed to all reviewers; cheap-first ordering.
AC-26 spec §2.1/§4/§6 + contract updated; AC-11 amended; no renumbering.
AC-27 `npm test` exits 0. AC-28 no secret material introduced.

## 12. Doc persistence (Obsidian vault, approval-gated)

`docs/` is an Obsidian vault (checked-in `.obsidian/` + `templates/` +
`_index.md`). Date separation: day folder `docs/YYYY-MM-DD/` holding
`plan-<slug>.md`, `decision-<slug>.md`, `adr-NNN-<slug>.md`; daily hub
`docs/daily/YYYY-MM-DD.md` with Dataview index (Dataview plugin is a
manual user install; every Dataview block ships with plain-link fallback).
Full Nygard ADR form (Status/Context/Decision/Consequences/Alternatives/
Links) with global `NNN` counter. `doc-writer` subagent (instruction-scoped
to `docs/`, refusal outside it — permission `edit: allow` is global in this
schema, not path-enforced) runs only after Stage 3 approval (draft plan +
decision) and Stage 6 sign-off (ADR + flip plan/decision to approved); never on
request-changes/kill/stop. All notes carry YAML frontmatter
(`type,date,status,tags,related,slug`) and date-prefixed wikilinks
(`[[YYYY-MM-DD/plan-<slug>]]`, `[[daily/YYYY-MM-DD]]`); secrets redacted
`[REDACTED]`.

DoD: DOC-01 vault opens with templates recognized; DOC-02 approved run
creates `YYYY-MM-DD/` with 3 frontmattered files; DOC-03 wikilinks resolve;
DOC-04 ADR follows Nygard headings; DOC-05 no write on unapproved runs;
DOC-06 daily hub lists day's notes with non-Dataview fallback; DOC-07
existing docs untouched except links.
