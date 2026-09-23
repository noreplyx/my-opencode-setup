**Overview:** `Stage 5/6 — Review loop | Status: in-progress` Review found two issues tied to `GH-01`; fixes are in progress.

**Non-technical:** Two checks failed and the team is fixing them; nothing needs your sign-off yet.

**Technical:** Details for review.

- **What happened:** `verifier` returned `verdict: fail` on `GH-01` [T1]; `retryLogin` [C5] still bursts.
- **What next:** `coder` — fix Finding 1 per its verbatim text, then re-verify.

**Finding 1 — Retry bursts under load (`GH-01`):**

- **Finding — plain-language:** logins can pile up and fail together during busy periods.
- **Finding — technical:** `retryLogin` [C5] retries without backoff in `src/auth.ts:12`; see quoted text.
- **Quoted finding (verbatim):**

```text
retry without backoff at src/auth.ts:12 severity=major rule=GH-01
```

> Sensitive quote annotated here: credential at `src/auth.ts:12` cited as [redacted: secret — see file:line + rule ID], never repeated.

**Task / Criterion details:**

- [T1] `GH-01` — Login retry limit: what-it-checks — retries stay bounded; fail-means — bursts can fail together; why-matters — keeps login stable [Source: planner registry].
- [T2] `GH-02` — Backoff present: what-it-checks — retries wait longer each try; fail-means — still bursty; why-matters — smooths load [Source: design v1 § Retry].
- [T3] `GH-03` — unknown — confirm in planner registry or design doc: what-it-checks — unknown — confirm check text; fail-means — unknown — confirm fail meaning; why-matters — listed so the ID is never unexplained [Source: unknown — confirm in planner registry].

**Code reference details:**

- [C1] `AuthService` (class): `src/auth.ts:20`; role — owns the login flow; context — calls the retry helper.
- [C2] `LoginAttempt` (table): `db/schema.ts:8`; role — stores one row per attempt; context — Finding 1 counts rows here.
- [C3] `MAX_RETRIES` (variable): `src/auth.ts:4`; role — caps retry count; context — Finding 1 bound under test.
- [C4] `backoffMs` (variable): unknown — confirm in `src/auth.ts`; role — wait between retries; context — fix adds it here.
- [C5] `retryLogin` (function): `src/auth.ts:12`; role — retries failed logins; context — Finding 1 bursts here.

**Terms explained:**

- **verifier:** the independent checker that re-runs tests after each fix.

**Summary:** Open questions: `None`. The coder is fixing Finding 1 (`GH-01` [T1], `retryLogin` [C5]); what happens next is re-verify, then re-review — proceed?
