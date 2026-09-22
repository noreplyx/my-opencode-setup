# AI Agent Pipeline — Gate-Hardened Spec (v1)

Doc home: `docs/ai-agent-pipeline.md`. Review-only; no runtime/code changes.

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
| 2 Plan | code-planner → orchestrator | Stage 1 handoff verbatim | Design doc v1 + DoD AC-01..AC-11 + files-to-touch |
| 2.5 Triage | orchestrator | Design doc present | Routing decision recorded (full / fast-track / stop) |
| 3 Approval | user (question tool) | Design + plan table + tradeoffs presented | Explicit approve / request-changes |
| 4 Implement | coder → orchestrator | Approved design + active checklist verbatim | Criterion-to-change/evidence mapping |
| 4.5 Verify | verifier (independent) | Coder handoff + DoD verbatim | Verdict pass (+ evidence per criterion); fail blocks Stage 5 |
| 5 Review loop | reviewers + scanner → coder → verifier | Verified diff + latest design | No Critical/Major, code-reviewer clean, verify pass, sign-offs recorded |
| 6 Sign-off | user (question tool) | Diff + verdicts + residuals presented | Approve-and-finish or request-changes |

### 2.1 Stage 5 steps (step-7 defined)

Stage 5 runs steps 1–7 in order: 1) scanner pass, 2) reviewers pass,
3) severity triage, 4) remand to coder with fix instructions, 5) coder rework,
6) verifier re-verification, 7) cap/escalation check — at the outer-pass cap
(≤ 2) escalate to the user for decision (fix / accept residual / kill) instead
of looping; below the cap, return to step 1 for the next outer pass.
| 7 VCS (opt-in) | vcs-committer | Stage 6 approval + explicit VCS request | `vcs: done <sha>` / `denied` / `not-taken` |

## 3. Validators per gate (pass / remand / kill)

Each gate has a validator: entry-check → verdict `pass` (advance), `remand`
(return to owner with fix instructions, counts toward caps), `kill`
(terminate per K-criteria). Validators: Stage 1 convergence check,
Stage 2 design completeness, Stage 2.5 triage eligibility,
Stage 3 approval response, Stage 4 mapping completeness,
Stage 4.5 independent verification, Stage 5 severity gate,
Stage 6 residual acceptance. Every validator verdict is logged with stage,
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
withdrawn. Kill is terminal with recorded reason; reversible only via new
pipeline run.

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

DoD IDs AC-01..AC-11 stable. Amend in place under same ID; withdrawn marked
with reason; new IDs continue numbering, never renumber.

## 10. Risk / auto_approve

Risk: medium. `auto_approve: false`. Consistent: no Stage 2.5 skip, no
fast-track, full Stage 3 + 6 checkpoints required. Approval lock: any change
to `auto_approve` requires explicit Stage 3 or Stage 6 user approval before
taking effect; the pipeline never flips it silently.

## 11. DoD AC-01..AC-11

AC-01 seven fields echoed. AC-02 entry/exit all stages. AC-03 validator per
gate. AC-04 max rounds stated. AC-05 triage routing. AC-06 K1–K5.
AC-07 fast-track denylist. AC-08 reversible. AC-09 stable IDs.
AC-10 risk/auto_approve consistent. AC-11 docs-only behavior holds: the
revision makes no runtime/code changes, verified by method `git diff --stat`
showing only `docs/ai-agent-pipeline.md` changed (docs-only).
