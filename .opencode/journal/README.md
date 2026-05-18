# Project Journal

This directory stores structured, append-only records of every pipeline the Orchestrator completes. It provides **cross-session memory** so the system remembers past work, decisions, and failures.

## File Format

Each pipeline run produces one entry appended to `journal.yaml`. The file is YAML with the following schema:

```yaml
- date: "2026-05-19T10:30:00Z"
  feature: "user-profile-service"
  pipelineType: "full"
  result: "pass"
  durationMinutes: 12
  filesChanged:
    - "src/services/user.ts"
    - "src/controllers/user.ts"
  keyDecisions:
    - "Used in-memory store instead of Redis (MVP phase)"
    - "Followed repository pattern for data access"
  circuitBreakerEvents: []
  failedGates: []
  notes: ""
```

## When to Write

The Orchestrator writes a journal entry after every pipeline that:
1. **Completes successfully** — all gates pass
2. **Fails after escalation** — circuit breaker opened, user was informed
3. **Produces key architecture decisions** — even if partial

## Journal Readers

- **Finder**: Reads journal when starting a new session to understand what's already been done
- **PlanDescriber**: Reads journal to ensure new plans are consistent with past decisions
- **Orchestrator**: Reads journal before dispatching to assess past failure patterns
