**Overview:** `Stage 5/6 — Review loop | Status: in-progress` Review found retry bursts in the login flow; fixes are in progress.

**Non-technical:** Logins pile up during busy periods and the team is fixing it; nothing needs your sign-off yet.

**Technical:** Details for review.

- **What happened:** `retryLogin` [C2] still bursts; `AuthService` [C1] owns the login flow.
- **What next:** `coder` — fix Finding 1 per its verbatim text, then re-verify.

**Finding 1 — Retry bursts under load (`src/auth.ts:12`):**

- **Finding — plain-language:** logins can pile up and fail together during busy periods.
- **Finding — technical:** `retryLogin` [C2] retries without backoff in `src/auth.ts:12`; see quoted text.
- **Quoted finding (verbatim):**

```text
retry without backoff at src/auth.ts:12 severity=major
```

**Code reference details:**

- [C1] `AuthService` (class): `src/auth.ts:20`; role — owns the login flow; context — calls the retry helper.
- [C2] `retryLogin` (function): `src/auth.ts:12`; role — retries failed logins; context — Finding 1 bursts here.

**Summary:** Open questions: `None`. The coder is fixing Finding 1 (`retryLogin` [C2]); what happens next is re-verify, then re-review — proceed?
