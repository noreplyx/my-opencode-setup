# Circuit Breaker

## Circuit Breaker Pattern

Three states:

| State | Meaning | Action |
|---|---|---|
| **Closed** | Normal operation | Agents execute as normal |
| **Open** | Repeated failures detected | Orchestrator pauses cycling to the same agent for the same issue |
| **Half-Open** | Probation period | Orchestrator allows one retry to test if the issue is resolved |

---

## Escalation Limits

| Condition | Limits | Escalation Target |
|---|---|---|
| Same bug reappears | 3 Fixer attempts | Escalate to PlanDescriber for roadmap revision |
| Same agent fails consecutively | 3 failures | Orchestrator pauses that agent path and reviews manually |
| Verifier score < 80% | 3 Fixer re-verification failures | Escalate to PlanDescriber for roadmap revision |
| Security Scan fails | 3 attempts | Escalate to user for direction |
| Total pipeline retries | > 5 across all gates | Orchestrator pauses and reports to user |

---

## Circuit Breaker Workflow (6-step)

```
1. Agent task fails (build, lint, smoke test, security scan, or verification)
2. Orchestrator records the failure in a counter for that specific check
3. If counter < threshold (3), Orchestrator cycles back:
   - Build/lint failures → cycle to Implementor
   - QA smoke test failures → cycle to Fixer
   - Verifier deviations → cycle to Fixer
   - Security scan failures → cycle to user for direction
4. If counter >= threshold, Orchestrator opens the circuit:
   a. Pauses further retries for that specific check
   b. Escalates to PlanDescriber if the root cause is plan-related
   c. Escalates to Fixer if code-related (with root cause analysis)
   d. Reports to user with failure summary and escalation decision
5. After PlanDescriber revises the plan, Orchestrator resets the circuit (Half-Open)
6. One retry is allowed — if it passes, circuit closes; if it fails, circuit opens again
```

---

## Counter Reset & Decay

### Reset Conditions

Circuit breaker counters are reset when:
- The task passes the gate successfully
- PlanDescriber revises the roadmap
- Fixer successfully resolves the root cause
- The Orchestrator manually resets after user intervention

### Counter Decay

- Counters auto-decay by **1 every 24 hours** (computed at pipeline start by reading `circuitBreaker.lastFailure.timestamp`)
- This prevents stale failures from accumulating across different features
- The **total-pipeline-retry counter has NO decay** (it is a global safety limit)
- Decay is computed by the Orchestrator at pipeline start: if `lastFailure` is > 24h old, decrement the counter (min 0)

**When decay meets threshold**: If a counter decays from 2 to 1 overnight but the same checkpoint fails again, the counter goes to 2 again (not 3). This means the agent gets one more attempt than it would without decay — fair because the first failures were on a different feature.

---

## Security-Specific Thresholds

| Pipeline Profile | securityScan Threshold | Supply Chain Threshold | evidenceQuality Threshold | Description |
|---|---|---|---|---|
| Standard | 3 | 1 | 3 | Default for most features |
| Sensitive (auth, payments, PII) | 3 | 3 | 3 | More lenient — supply chain issues can be fixed |
| Infrastructure | 3 | 3 | 3 | Security-critical config changes |
| Security Fix | 3 | 3 | 3 | Fixes for known vulns — chain issues expected |

The security profile is set based on the feature type in the pipeline selection:
- Features touching auth, payment, PII, or security → "Sensitive"
- Config/deployment changes → "Infrastructure"
- Security vulnerability fixes → "Security Fix"
- All others → "Standard"

---

## Smart Circuit Breaker Thresholds

Contextual thresholds by task complexity:

| Gate | Simple Task | Moderate Task | Complex Task |
|---|---|---|---|
| Build | 1 | 2 | 3 |
| Lint | 1 | 2 | 3 |
| Security Scan | 1 | 2 | 3 |
| Smoke Test | 1 | 2 | 3 |
| Verifier | 1 (single file) | 2 (2-3 files) | 3 (4+ files) |
| Evidence Quality | 2 | 3 | 4 |

### Task Complexity Classification

| Complexity | Criteria |
|---|---|
| **Simple** | Config change, single file, < 50 lines changed |
| **Moderate** | 2-3 files, new feature in familiar domain |
| **Complex** | 4+ files, new domain, cross-module changes |

---

## Semantic Circuit Breaker (Failure Signature Tracking)

### Problem

The simple circuit breaker tracks failure counts per gate but doesn't understand *why* failures occur. Three `verifier` failures might all have different root causes. Each failure is treated identically, leading to premature or delayed escalation.

### Solution: Failure Signature Tracking

Each failure is hashed into a `failureSignature` based on:
- `agent` — Which agent failed
- `gate` — Which gate (build, lint, security, smoke, verifier)
- `classification` — Root cause classification (from Fixer)
- `primaryCause` — Normalized root cause description

```
failureSignature = SHA256(agent + ":" + gate + ":" + classification + ":" + primaryCause)
```

### Circuit Breaker State (updated schema)

```yaml
circuitBreaker:
  state: "closed"
  # ── OLD: Simple counters ──
  counters:
    build: 0
    lint: 0
    verifier: 0
  # ── NEW: Per-signature tracking ──
  signatures:           # Tracks distinct failure signatures
    - signature: "a1b2c3d4..."
      gate: "verifier"
      agent: "implementor"
      classification: "implementation-error"
      primaryCause: "Missing export for validateEmail"
      count: 2
      lastSeen: "2026-05-19T10:30:00Z"
    - signature: "e5f6g7h8..."
      gate: "verifier"
      agent: "fixer"
      classification: "plan-omission"
      primaryCause: "Plan did not specify duplicate email handling"
      count: 1
      lastSeen: "2026-05-19T10:35:00Z"
```

### Escalation Rules

| Condition | Action |
|---|---|
| Same signature count >= 3 | Open circuit — the same fix isn't working |
| Different signatures, total >= 3 | Do NOT open circuit — different problems each time, keep trying |
| Same classification count >= 3 | Auto-escalate to PlanDescriber — the root cause category keeps recurring |
| Mixed signatures + mixed classifications >= 5 | Open circuit — too many distinct failures, need user intervention |

### Benefits over Simple Counter

- **Prevents premature escalation**: 3 unique failures (each with a different root cause) shouldn't stop the pipeline
- **Prevents under-escalation**: 3 identical failures (same missing export, same classification) signal the same fix isn't working
- **Provides actionable data**: The failure signature list tells the Orchestrator exactly which root causes are recurring
- **Enables pattern-aware escalation**: If "edge-case-miss" keeps appearing across different features, that's a PlanDescriber training issue

---

## Pattern-Based Circuit Breaker (Enhanced)

### Purpose

The old circuit breaker tracked simple retry counts (build: 3, lint: 3, etc.). The enhanced version tracks **failure patterns** — distinct signatures of what failed and why — to make smarter escalation decisions. This prevents infinite Fixer→Verifier loops by detecting the pattern and routing directly to PlanDescriber.

### Signature-Based Failure Tracking

Each failure generates a SHA256-based signature:

```
signature = SHA256(gate + ":" + agent + ":" + classification + ":" + primaryCause)[:8]
```

Example:

```yaml
circuitBreaker:
  patternSignatures:
    - signature: "a1b2c3d4"
      gate: "verifier"
      agent: "fixer"
      classification: "plan-omission"
      primaryCause: "Plan did not specify duplicate email handling"
      count: 2                # Incremented when same signature repeats
      firstSeen: "2026-05-19T10:25:00Z"
      lastSeen: "2026-05-19T10:35:00Z"
```

### Escalation Logic

| Condition | Circuit State | Action |
|---|---|---|
| Any single signature.count >= 3 | closed → open | Same fix not working — STOP cycling. Escalate to user. |
| Same classification appears in >= 3 distinct signatures | closed → half-open | Same TYPE of failure. Escalate to PlanDescriber for plan revision. |
| Fixer→Verifier cycle repeats >= 3 times (detected from cyclePatternHistory) | closed → half-open | Loop detected. Skip Fixer and go directly to PlanDescriber. |
| >= 5 distinct signatures with mixed classifications | closed → open | Multiple different failures. Flag for user review. |
| After PlanDescriber revises the plan | open → closed | Reset all counters and signatures. Fresh start. |

### Cycle Pattern Detection

The circuit breaker tracks agent dispatch sequences to detect loops:

```yaml
cyclePatternHistory:
  - pattern: "fixer-verifier-loop"
    occurrences: 2
    lastOccurrence: "2026-05-19T10:35:00Z"
    recommendedAction: "escalate-to-plandescriber"
```

Detection logic:
1. After each agent completes, check if the last 2-3 steps form a repeating pattern
2. Patterns: fixer→verifier→fixer, implementor→build→fixer→build, etc.
3. If same pattern repeats >= 2 times → record in cyclePatternHistory
4. If any pattern reaches >= 3 occurrences → trigger escalation

### Integration with Pre-Flight

The `pipeline-init.ts` script now initializes the pattern-based circuit breaker:

```yaml
circuitBreaker:
  patternSignatures: []
  escalationSignals:
    sameSignatureThresholdReached: false
    sameClassificationThresholdReached: false
    totalDistinctSignatures: 0
    totalClassificationInstances: {}
    recommendedAction: "No failures yet"
    escalationHistory: []
  patternDetection:
    cyclePatternHistory: []
```

---

## Pattern Detection

The circuit breaker now detects failure patterns across gates:
- If Fixer fails on 3 different bugs in the same pipeline with the same classification (`edge-case-miss`), auto-escalate to PlanDescriber after attempt 2 (not 3)
- If the same checkpoint fails across 2 different attempts, flag as "persistent deviation" and escalate sooner
- If build fails on 3 different modules sequentially, escalate to user (may be a toolchain issue, not implementation)

---

## Graceful Degradation

When a gate fails after max attempts, the pipeline still delivers partial results:
- "Plan verification failed (72%), but build and smoke tests pass. Here's what was implemented and what needs review."
- Generate a "partial delivery report" with:
  - ✅ What passed
  - ❌ What failed
  - 🔍 What needs human review
- Do NOT delete files or undo work on partial failure — the user may want to keep working changes

---

## Agent Action Audit Trail

### Purpose

Every agent action that modifies files, installs dependencies, or changes configuration is recorded in a **tamper-evident audit log**. This provides:
- Immutable record of what each agent did during the pipeline
- Hash chain integrity — tampering is detectable
- Forensic evidence if an agent goes rogue

### Audit Log Tool

```bash
# Initialize audit log for a pipeline
ts-node skills/scripts/orchestration/audit-log.ts init --pipeline-id=<id> --feature=<name>

# Append an action entry
ts-node skills/scripts/orchestration/audit-log.ts append \
  --pipeline-id=<id> \
  --agent=<agent-name> \
  --action=<action-type> \
  --details=<json> \
  --file-hashes=<json>

# Verify chain integrity
ts-node skills/scripts/orchestration/audit-log.ts verify --pipeline-id=<id>

# Print human-readable report
ts-node skills/scripts/orchestration/audit-log.ts report --pipeline-id=<id>
```

### Valid Action Types

| Action | Description | Requires file-hashes |
|---|---|---|
| `file_write` | Agent created a file | Yes |
| `file_modify` | Agent modified a file | Yes |
| `file_delete` | Agent deleted a file | No |
| `npm_install` | Agent installed/updated packages | No |
| `build` | Agent ran the build | No |
| `lint` | Agent ran the linter | No |
| `security_scan` | Security scan was run | No |
| `qa_test` | QA ran tests | No |
| `git_commit` | Agent committed changes | No |
| `config_change` | Agent modified config | Yes |

### When to Log

The Orchestrator records audit entries after each agent completes:
1. Parse the agent's `changedFiles` from structured output
2. For each changed file, compute SHA-256 hash
3. Append audit entry with action type matching the agent's role
4. After the pipeline ends, run `verify` to confirm chain integrity

### Location

Audit logs are stored at `.opencode/audit/<pipeline-id>.audit.yaml`

### Stale Audit Log Cleanup

Audit logs older than 30 days should be archived or deleted during pipeline teardown.

---

## Evidence Validation Gate

After EVERY agent returns its output (before updating agent-context.md), the Orchestrator MUST run the Evidence Validation Gate:

### Commands
```bash
# Step 1: Validate output contract structure
ts-node skills/scripts/orchestration/validate-output-contract.ts --file=<agent-output-file>

# Step 2: Validate truthfulness of claims (re-verify against filesystem)

# Step 3: Score evidence quality
```

### Gate Rules
| Check | Pass | Fail |
|-------|------|------|
| Output contract schema | All required fields present | Missing required fields → cycle back to agent |
| Truthfulness score | >= 95% | < 95% → return refuted claims to agent for correction |
| Evidence quality score | >= 70 | < 70 → warn Orchestrator, add evidence requirements to next hand-off |

### Circuit Breaker for Evidence Quality
If an agent submits evidence quality < 70 for 3 consecutive attempts:
1. First low quality: Warn agent with specific feedback
2. Second low quality: Cycle back with explicit evidence template
3. Third low quality: Open circuit breaker → escalate to Orchestrator

### Cross-Agent Evidence Provenance
Every plan manifest checkpoint now tracks its lifecycle through the pipeline:

```json
{
  "id": "CP-003",
  "type": "behavioral",
  "description": "validateEmail handles invalid input",
  "target": "src/services/user.ts",
  "provenance": {
    "createdBy": "PlanDescriber",
    "implementedBy": "Implementor",
    "implementationEvidence": {
      "claim": "validateEmail throws on invalid email",
      "command": "grep -n 'throw.*Invalid email' src/services/user.ts"
    },
    "verificationResult": {
      "verdict": "fail",
      "verifier": "Verifier",
      "evidence": { "result": "not_found" }
    },
    "fixedBy": "Fixer",
    "fixEvidence": {
      "claim": "Added error handling to validateEmail",
      "command": "grep -n 'throw new ValidationError' src/services/user.ts"
    }
  }
}
```

### Provenance Tracker Commands
```bash
# Implementor records implementation evidence
ts-node skills/scripts/orchestration/provenance-tracker.ts --implement --manifest=... --agent=implementor --session=<ses_id> --file=<path> --lines=<range> --claim="..."

# Verifier records verification results
ts-node skills/scripts/orchestration/provenance-tracker.ts --verify --manifest=... --checkpoint=<id> --verdict=<pass|fail> --evidence="command" --result=<found|not_found>

# Fixer records fix
ts-node skills/scripts/orchestration/provenance-tracker.ts --fix --manifest=... --checkpoint=<id> --agent=fixer --session=<ses_id> --file=<path> --lines=<range> --claim="..."

# View full provenance chain
ts-node skills/scripts/orchestration/provenance-tracker.ts --view --manifest=... --checkpoint=<id>
```

---

## Failure Summary Format

When the circuit breaker opens (retry threshold reached), the Orchestrator produces a structured failure summary in `agent-context.md`'s YAML frontmatter under the `failureSummary` field:

```json
{
  "feature": "user-profile",
  "pipelineType": "full",
  "failedStep": "verifier",
  "attempts": 3,
  "rootCause": {
    "primary": "PlanDescriber omitted error handling checkpoint for duplicate email scenario",
    "contributing": [
      "Implementor followed plan exactly but plan was incomplete",
      "Fixer attempted fix 3 times but kept missing the root cause because the plan never specified the error scenario"
    ]
  },
  "attemptsLog": [
    { "attempt": 1, "agent": "implementor", "result": "build pass, verifier 72%", "fix": "added validateEmail export" },
    { "attempt": 2, "agent": "fixer", "result": "build pass, verifier 82%", "fix": "added error handling for createUser" },
    { "attempt": 3, "agent": "fixer", "result": "build pass, verifier 78%", "fix": "added additional error cases" }
  ],
  "recommendedAction": "Revise plan to add explicit error handling checkpoints for all user service methods",
  "circuitBreakerState": {
    "build": 0,
    "lint": 0,
    "securityScan": 0,
    "smokeTest": 0,
    "verifier": 3
  }
}
```

### When to Produce

- After any gate fails and reaches 3 attempts
- Written to `agent-context.md`'s YAML frontmatter under the `failureSummary` field
- Also presented to the user as a structured markdown report (not raw JSON)

---

## User Report Format

```markdown
## ⚠️ Pipeline Failure: user-profile

| Field | Value |
|---|---|
| Feature | user-profile |
| Pipeline | full |
| Failed Step | verifier (3 attempts) |
| Attempts | 3 |

### Root Cause Analysis
**Primary**: PlanDescriber omitted error handling checkpoint for duplicate email scenario.
**Contributing**: Implementor followed plan exactly but plan was incomplete.

### Attempts Log
1. **Implementor**: build pass, verifier 72% — added validateEmail export
2. **Fixer**: build pass, verifier 82% — added error handling for createUser
3. **Fixer**: build pass, verifier 78% — added additional error cases

### Recommended Action
Revise the plan to add explicit error handling checkpoints for all user service methods.

### Next Steps
I'll escalate to PlanDescriber for a roadmap revision. After the plan is updated, we'll retry implementation. Shall I proceed?
```

---

## Standardized Error Format

All agents should report failures using this structured format for consistent parsing:

```yaml
errors:
  - code: "BUILD_FAILED"
    step: "npm run build"
    details: "TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'"
    file: "src/services/user.ts"
    line: 47
    severity: "error"        # error | warning
```

### Error Fields

| Field | Required | Description |
|---|---|---|
| `code` | ✅ | Machine-readable error code (SCREAMING_SNAKE_CASE) |
| `step` | ✅ | The pipeline step that produced the error (e.g., "npm run build", "eslint src/", "QA smoke test") |
| `details` | ✅ | Human-readable error message with context |
| `file` | ❌ | File path where the error occurred (if applicable) |
| `line` | ❌ | Line number in the file (if applicable) |
| `severity` | ✅ | "error" (blocking) or "warning" (non-blocking) |

### Common Error Codes

| Code | Meaning |
|---|---|
| `BUILD_FAILED` | TypeScript/Webpack/Vite compilation error |
| `LINT_FAILED` | ESLint/Prettier style violation |
| `TEST_FAILED` | Unit/integration test assertion failure |
| `SMOKE_FAILED` | Application failed to start/boot |
| `SECURITY_HIGH` | npm audit High severity vulnerability |
| `SECURITY_CRITICAL` | npm audit Critical severity vulnerability |
| `SECRETS_FOUND` | Hardcoded credentials detected |
| `VERIFIER_LOW_SCORE` | Compliance score below 80% threshold |
| `IMPORT_MISMATCH` | Cross-file import path or symbol mismatch |
| `TYPE_MISMATCH` | Type signature mismatch between modules |
| `MISSING_EXPORT` | Expected export not found in module |