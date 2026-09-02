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
