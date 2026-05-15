# Worked Example — Full Brainstorming Session

Below is a concise example showing what a completed brainstorming session should look like in practice. This is a reference for format and depth, not a script to copy verbatim.

> **User:** "I need to add rate limiting to my Express API. Small project, about 5 routes, ~100 req/s. What should I use?"
>
> **Agent (Phase 1 — Questioning):**
> "A few questions first to narrow things down:
> 1. Is 100 req/s the peak or average? What's the burst behavior?
> 2. Do you need different rate limits per route (e.g., login gets stricter limits than public pages)?
> 3. Is this single-process or do you plan to scale horizontally later?
>
> Based on your description (small project, single server, ~100 req/s), I'll present two approaches assuming a single-process deployment with global limits. If your answers differ, we can adjust.
>
> **Phase 3 — Plan Generation (2 plans with full analysis):**
>
> **Plan A: In-Memory Sliding Window**
> Goal: Simple, zero-infrastructure rate limiter that ships in hours.
>
> ```mermaid
> graph LR
>   Client -->|Request + IP| API
>   API -->|check window| Mem[(In-Memory Map)]
>   Mem -->|under limit| Next[Process Route]
>   Mem -->|over limit| Reject[429 Too Many Requests]
> ```
>
> **Pros:**
> | # | Pro | Impact | Evidence |
> |---|---|---|---|
> | 1 | **No new dependencies** | High | Uses plain JS Map/object — nothing to install |
> | 2 | **Ships in one afternoon** | High | ~50 lines of middleware, no config |
> | 3 | **Simple to reason about** | Med | Sliding window logic is well-understood |
> | 4 | **Easy to test** | Med | Pure function, injectable state |
> | 5 | **No network calls** | High | No Redis, no DB hit — latency <1ms |
>
> **Cons:**
> | # | Con | Severity | Mitigation |
> |---|---|---|---|
> | 1 | **Lost on restart** | High | Acceptable for a small project; use persistent store later |
> | 2 | **Doesn't work across processes** | High | If you scale to multiple Node instances, each has its own counters |
> | 3 | **Memory grows with unique IPs** | Low | ~1KB per IP; at 10k unique IPs that's ~10MB — fine |
> | 4 | **No distributed coordination** | Med | No mitigation in this plan — upgrade to Plan B if scaling |
> | 5 | **Window reset behavior can be bursty** | Low | Trade-off accepted for simplicity |
>
> **Strategic Fit:**
> | Dimension | Rating | Rationale |
> |---|---|---|
> | Speed of delivery | 9/10 | Can ship today |
> | Maintainability | 7/10 | Simple code, easy to modify |
> | Scalability | 3/10 | Breaks at >1 process |
> | Ops complexity | 9/10 | Nothing to deploy or monitor |
> | Architecture alignment | 8/10 | Fits a small Express app perfectly |
>
> **Risk Profile:**
> | Risk | Likelihood | Impact | Mitigation |
> |---|---|---|---|
> | Rate limits reset on restart | High | Low | Accept — limits re-populate naturally |
> | In-memory drift under high concurrency | Low | Med | Use atomic counters or a lock |
>
> **Verification:**
> - Test cases: `curl` test sending 101 requests in 1 second — confirm the 101st returns 429
> - Success metrics: All 100 requests within limit pass; request 101 is rejected
> - Rollback trigger: If legitimate users are getting 429s (false positives), roll back
> - Rollback execution: Remove the middleware import from the route file — trivial revert
>
> **Plan B: Redis Sliding Window**
> Goal: Production-ready rate limiting that survives restarts and scales horizontally.
>
> (Similar depth for Plan B...)
>
> **Phase 4 — Comparative Matrix:**
>
> | Criterion | Plan A: In-Memory | Plan B: Redis |
> |---|---|---|
> | Time to ship | 2 hours | 1 day |
> | Survives restart | ❌ | ✅ |
> | Multi-process | ❌ | ✅ |
> | Ops burden | None | Redis instance (~$15/mo) |
>
> **Phase 5 — Decision:** "For your 5-route, 100 req/s project, I'd recommend Plan A — it matches your scale perfectly. You can always swap in Redis when you outgrow it.
>
> If neither approach fits your needs, let me know what's missing and I can pivot to entirely different options. What do you think?"

## Key Takeaways

This example illustrates all the required elements of a proper brainstorming session:

| Element | Shown? | Notes |
|---------|--------|-------|
| Deep questions first | ✅ | 3 probing questions before plans |
| Multiple distinct plans | ✅ | 2 approaches (in-memory vs Redis) |
| 5+ pros with impact | ✅ | Each plan has 5 pros |
| 5+ cons with severity | ✅ | Each plan has 5 cons |
| 3+ concerns surfaced | ✅ | Concerns are woven into the cons |
| Strategic fit analysis | ✅ | 1-10 rating across 5 dimensions |
| Risk profile | ✅ | Likelihood x Impact x Mitigation |
| Verification strategy | ✅ | Tests, metrics, rollback trigger + steps |
| Comparative matrix | ✅ | Side-by-side comparison |
| User decision prompt | ✅ | Asks user to choose or pivot |
