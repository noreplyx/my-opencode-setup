# Finding schema (normative)

This document is the single normative definition of a review-stage finding.
Every reviewer, the security scanner, and the orchestrator emit findings in this
shape; `scripts/review-ledger.mjs` is the **test-time arbiter** and the canonical
implementation of every rule stated here. Where prose and the module disagree,
the module governs.

## Required fields

Every finding is an object carrying these eight required fields (the closed
set checked by `REQUIRED_FINDING_FIELDS`); unknown extra properties are
tolerated:

| Field | Type | Meaning |
|---|---|---|
| `rule_id` | string | Stable rule/lens identifier (scanner rule ID, or a reviewer-owned lens rule such as `SEC-SQLI-01`). |
| `category` | enum | One of the closed eight-value category enum below. |
| `file` | string | Repository-relative path (normalized, see fingerprint). |
| `line` | integer | 1-based line number, must be `>= 1`; metadata only, never part of identity. |
| `symbol` | string | Enclosing function/class/table/variable; empty string is allowed. |
| `cwe` | string | CWE identifier (`CWE-89`) or empty string when not applicable. |
| `root_cause_key` | string | Short slug naming the root cause (grammar below). |
| `fingerprint` | string | `category/rule_id/file#symbol` (formula below). |

These eight fields are required; unknown extra properties are tolerated, not
rejected. `severity` is **required** (one of the four values below); `evidence`
is mandatory in practice — `validateFinding` does not reject a missing
`evidence`, but normalization auto-downgrades it to `Nit` (below), so it is
never a validation failure. For secrets, `incident` is required and validated.
`sources` is optional.

## Closed category enum

`category` is exactly one of these eight values. No other value is accepted:

`security`, `performance`, `best-practices`, `reliability`,
`test-correctness`, `dependency`, `secret`, `style`

## `root_cause_key` slug grammar

`root_cause_key` must match `^[a-z0-9]+(-[a-z0-9]+)*$`: lowercase ASCII
alphanumerics joined by single hyphens, no leading/trailing/double hyphen.

## Fingerprint formula

`fingerprint` is derived only from identity-bearing fields — **`line` is
excluded** so the same root cause does not churn as edits shift it:

```
fingerprint = `${category}/${rule_id}/${file}#${symbol}`
```

- `file` is normalized: backslashes become `/`, then any leading `./` and any
  leading `/` are stripped (`./src/a.ts` → `src/a.ts`; `\src\a.ts` →
  `src/a.ts`; `/abs/a.ts` → `abs/a.ts`).
- `%`, and `#` (and `/` outside the `file` component) are percent-encoded in
  the emitted fingerprint.
- An empty `symbol` normalizes to the literal `-`, so
  `security/SEC-1/src/a.ts#-` is stable when no symbol is known.

## Severity rubric (concrete anchors)

`severity` is exactly one of `Critical`, `Major`, `Minor`, `Nit`:

- **Critical** — exploitable vulnerability, data loss, or a guaranteed
  main-path crash.
- **Major** — concrete incorrect behavior or resource exhaustion on a plausible
  path.
- **Minor** — limited consequence; a real but bounded defect.
- **Nit** — preference only, with no stated consequence.

## Mandatory evidence / proof rule

Every finding must carry `evidence`: a concrete command + result, a failing
test, a code citation (`file:line`), or a scanner `rule_id` plus its SARIF
location. **A finding with no evidence is auto-downgraded to `Nit`** before any
merge or severity collapse.

## Incident marker for secrets

Every secret finding (`category: "secret"`) must set `incident: true`,
**regardless of severity**. It takes the incident path (rotate/purge + ignore
the artifacts) and is never handed to the coder fix loop. A no-evidence secret
is not downgraded to `Nit`: secret/incident findings keep their severity so the
incident path stays blocking.

## Baseline entry shape

`docs/review-baseline.json` is `{ "version": 1, "entries": { ... } }`. Each
entry is keyed by fingerprint and carries at least:

```json
{
  "fingerprint": "security/SEC-1/src/a.ts#-",
  "severity": "Minor",
  "reason": "accepted risk",
  "approved_by": "user",
  "expires": "2026-12-31T00:00:00.000Z",
  "touched": false
}
```

A baseline match suppresses the finding; it lifts (never suppresses) for any of
these reasons, named verbatim by `baselineMatch`: `touched-file` (the matching
file changed), `expired` (the entry's expiry has passed), `invalid-expiry` (the
entry's `expires` is missing or malformed — fails closed), `unapproved-entry`
(the entry lacks a non-empty `approved_by`), `invalid-entry` (the entry's own
`severity` is missing or malformed), or `severity-mismatch` (the entry's
`severity` differs from the finding's). The Stage 6 sign-off is the
approver and expiry is mandatory. Suppression — baseline suppression — is never
applied to a secret/incident finding or to any `Critical`/`Major` finding
(severity floor); the floor scopes to baseline suppression, not the
Stage-6-approved `accepted` ledger state, which `nextState` preserves and
`openCriticalMajorCounts` excludes. A missing/malformed `expires` fails closed
rather than suppressing forever. `pruneBaseline(baseline.entries, now)` drops
only genuinely expired entries once per run, retains invalid-expiry and
non-object entries for repair, and returns the full `{version, entries,
warnings}` document so the durable `{ "version": 1, "entries": {…} }` wrapper
survives write-back; the orchestrator logs/escalates each warning.

## Fenced JSON findings block

Findings are emitted in a fenced `json` block so the orchestrator can parse
them deterministically:

```json
{
  "findings": [
    {
      "rule_id": "SEC-SQLI-01",
      "category": "security",
      "file": "src/db.ts",
      "line": 42,
      "symbol": "findUser",
      "cwe": "CWE-89",
      "root_cause_key": "sql-string-concat",
      "fingerprint": "security/SEC-SQLI-01/src/db.ts#findUser",
      "severity": "Major",
      "evidence": "grep -n 'SELECT .* +' src/db.ts",
      "sources": ["security-reviewer"]
    }
  ]
}
```

The orchestrator merges by `fingerprint` (never `file:line` plus prose),
normalizes severity before collapsing duplicates to the maximum severity, and
then updates the ledger. `scripts/review-ledger.mjs` is the arbiter that
enforces this contract at test time.
