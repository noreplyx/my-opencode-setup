# Delegation contract

Every orchestrator-to-subagent handoff must include this contract, copied
without renaming or omitting fields:

- **Goal** — the outcome requested by the user.
- **Scope** — files, systems, and behaviors included; explicitly name
  exclusions.
- **Constraints** — permissions, compatibility, safety, and process limits.
- **Inputs** — the request, repository context, and preceding handoff data.
- **Expected output** — the required structured response from this stage.
- **Completion criteria** — testable conditions that define done.
- **Risks/ambiguities** — known risks, assumptions, and questions requiring
  escalation.

The planner owns the acceptance criteria. Criteria must have stable IDs and
state the expected behavior plus how it can be verified. The coder maps every
criterion to changed areas and evidence. The verifier independently checks
each criterion and reports `pass`, `fail`, or `not-verifiable`; the coder's
report is context only and is never verification evidence by itself.

Required evidence is a concrete command result, test result, file/line
inspection, or other reproducible observation. A completion decision requires
a verifier `pass`, every criterion marked `pass`, and evidence for every
criterion. `fail`, missing evidence, or `not-verifiable` blocks completion.
User sign-off may resolve `not-verifiable` only when the orchestrator records
the sign-off explicitly; it does not convert a failed criterion into a pass.

Existing task inputs remain valid: when a caller supplies unstructured input,
the orchestrator preserves it under **Inputs** and derives the remaining
fields before delegating.

## Finding schema, ledger, and baseline

Review-stage findings carry the eight required fields defined by
`agent/finding-schema.md` (`rule_id`, `category`, `file`, `line`, `symbol`,
`cwe`, `root_cause_key`, `fingerprint`); `scripts/review-ledger.mjs` is the
test-time arbiter. `category` is the closed eight-value enum, and the merge key
is `fingerprint` = `category/rule_id/file#symbol` (line excluded, `file`
normalized, empty `symbol` → `-`). Severity is normalized (no evidence →
`Nit`) before duplicates collapse at maximum severity, except secret/incident
findings, which are never downgraded. `normalizeFindings` returns
`{ valid, invalid }`; a schema-invalid finding is never silently dropped — it
is surfaced as a synthetic Major "malformed finding — needs review" and routed
to escalation. The per-run ledger
tracks `open`/`fixed`/`regressed`/`recurring`/`accepted` states; the only
durable artifact is `docs/review-baseline.json`, shaped
`{ "version": 1, "entries": {} }`. The ledger is baseline-only: it is not
persisted, and its `accepted` entries are supplied by the orchestrator from the
durable baseline, not authored per run. Each baseline entry requires an
**approver** (the Stage 6 sign-off) and a mandatory **expiry**; an exact
fingerprint match suppresses the finding. The baseline suppression lifts — never
suppresses — for any of these reasons, named verbatim by `baselineMatch`:
`touched-file` (the file changed), `expired` (the expiry passed),
`invalid-expiry` (missing/malformed expiry, fails closed), `unapproved-entry`
(no non-empty `approved_by`), `invalid-entry` (the entry's own `severity` is
missing/malformed), or `severity-mismatch` (the entry severity differs from the
finding). The severity floor is a
baseline-suppression rule only: a `Critical`/`Major` finding is never suppressed
by a baseline entry, and neither is a secret/incident finding, and a
missing/malformed expiry fails closed rather than suppressing forever. The floor
does not affect the Stage-6-approved `accepted` ledger state: an `accepted` entry
is preserved by the ledger and excluded from open counts; it is not baseline
suppression and is not touched by the floor. `pruneBaseline(baseline.entries, now)` drops
only genuinely expired entries, retains invalid-expiry/non-object entries for
repair, and returns the full `{version, entries, warnings}` document so the
durable wrapper survives write-back. A secret finding (`category: secret`,
`incident: true`, any severity — Critical in practice) follows the incident path
(rotate/purge + ignore artifacts) and is never routed to the coder loop. A
`not-verifiable` item is classified by
cause and mapped to one route: `no-tooling` → add-tooling to the `coder`,
`external` → user sign-off, `manual` → user sign-off, `ambiguous` → redefine with the
`code-planner`.

## Deferred roadmap and non-goals

This contract governs prompt-level handoffs and recorded validation only. The
following are explicitly deferred or out of scope:

- A live remote delegation transport, durable handoff store, or production
  orchestration API is deferred.
- Authentication, authorization, permissions, credentials, and MCP behavior
  are not changed by contract validation, except for the repository-wide
  ClickUp denial policy.
- End-to-end tests against external agents, services, or user approval are
  non-goals; the repository fixture covers the deterministic handoff protocol.
