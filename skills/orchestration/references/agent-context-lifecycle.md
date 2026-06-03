# Agent Context Lifecycle (`agent-context.md`)

## Purpose

Single unified state file merging `agent-context.md` and `agent-status.json`. Located at `agent-context.md` in the workspace root.

- **Single source of truth**: No split-brain between two files — circuit breaker state, agent history, git state, and failure summaries live in one place.
- **State preservation**: Each agent knows what was done before them, what the circuit breaker state is, and what's expected next.
- **Cycle-back memory**: When Fixer or other agents cycle back, they see the full attempt history and failure context.
- **Cross-agent consistency**: All agents read the same unified state — no sync issues.

---

## Format

The file uses YAML frontmatter (machine-readable) + Markdown body (human-readable).

### YAML Frontmatter Schema

```yaml
---
# ── Pipeline Identity ──
pipelineId: "uuid-or-timestamp"
feature: "user-profile"
pipelineType: "full"
currentStep: "fixer"
status: "running"
createdAt: "2025-05-19T10:00:00Z"

# ── Agent History (append-only) ──
agentHistory:
  - step: "finder"
    agent: "ses_xxx"
    result: "completed"
    summary: "Found existing User model at src/models/user.ts"
    decisions:
      - what: "Chose Zod over Joi for input validation"
        why: "Already in dependency tree"
        by_who: "finder"
    warnings:
      - "src/models/user.ts uses `any` type for email field"
    changedFiles: []
    artifacts:
      - "Exploration report"

  - step: "planDescriber"
    agent: "ses_yyy"
    result: "completed"
    summary: "Created roadmap: 3 phases, 8 steps"
    decisions:
      - what: "Split into 3 phases (model, service, controller)"
        why: "Clear dependency ordering"
        by_who: "planDescriber"
    warnings: []
    changedFiles:
      - "plan-manifests/user-profile/v1-manifest.json"
    artifacts:
      - "Roadmap"
      - "plan-manifests/user-profile/v1-manifest.json"

  - step: "implementor"
    agent: "ses_zzz"
    result: "completed"
    summary: "Created src/services/user.ts, src/controllers/user.ts"
    decisions: []
    warnings:
      - "TypeScript strict mode not enabled"
    changedFiles:
      - "src/services/user.ts"
      - "src/controllers/user.ts"
    artifacts:
      - "src/services/user.ts"
      - "src/controllers/user.ts"

# ── Agent Output Contract Data ──
agentOutputs:
  finder:
    status: "completed"
    resultSummary: "Found existing User model"
    buildPassed: null
    lintPassed: null
  implementor:
    status: "completed"
    resultSummary: "Created user service and controller"
    buildPassed: true
    lintPassed: true
    buildOutput: "[full stdout + stderr]"
    lintOutput: "[full stdout + stderr]"

# ── Circuit Breaker State ──
circuitBreaker:
  state: "closed"
  counters:
    build: 0
    lint: 0
    securityScan: 0
    smokeTest: 0
    verifier: 0
  thresholds:
    build: 3
    lint: 3
    securityScan: 3
    smokeTest: 3
    verifier: 3

# ── Git State ──
gitState:
  branch: "feature/user-profile"
  dirtyFiles: []
  lastCommitSha: "abc123def456"

# ── Next Objective ──
nextObjective: "Fix Verifier deviations (CP-003, CP-007)"
---
```

### Additional Fields

#### Pipeline Heartbeat

Updated with a `pipelineHeartbeat` timestamp every time the file is written (enables stale detection).

```yaml
pipelineHeartbeat: "2025-05-19T10:30:00Z"
```

#### Checkpoint Progress

```yaml
checkpointProgress:
  planManifest: "plan-manifests/user-profile/v1-manifest.json"
  totalCheckpoints: 8
  passedCheckpoints: 6
  failedCheckpoints: 2
  adherenceScore: 0.75
  contractRules: []
```

#### Failure Summary

```yaml
failureSummary:
  feature: "user-profile"
  pipelineType: "full"
  failedStep: "verifier"
  attempts: 3
  rootCause:
    primary: "PlanDescriber omitted error handling checkpoint..."
    contributing:
      - "Implementor followed plan exactly but plan was incomplete"
  attemptsLog:
    - { attempt: 1, agent: "implementor", result: "build pass, verifier 72%", fix: "added validateEmail export" }
    - { attempt: 2, agent: "fixer", result: "build pass, verifier 82%", fix: "added error handling for createUser" }
    - { attempt: 3, agent: "fixer", result: "build pass, verifier 78%", fix: "added additional error cases" }
  recommendedAction: "Revise plan to add explicit error handling checkpoints..."
  circuitBreakerState:
    build: 0
    lint: 0
    securityScan: 0
    smokeTest: 0
    verifier: 3
```

#### Summaries (Progressive Summarization)

```yaml
summaries:
  finder: "Found User model at src/models/user.ts. Key finding: existing validation middleware in src/middleware/validate.ts."
  plandescriber: "3-phase roadmap: model, service, controller. 8 checkpoints in manifest."
  implementor: "Build passed (1 warning). Lint passed. Created src/services/user.ts, src/controllers/user.ts."
  qa: "Smoke test passed. 2 edge cases generated. 1 non-functional issue (performance)."
  verifier: "72% compliance. 2/8 checkpoints failed (CP-003, CP-007). Confidence: LOW."
```

#### Loaded Skills

```yaml
loadedSkills:
  - name: "code-philosophy"
    sections: ["naming", "exports"]
    priority: 8
  - name: "accessibility"
    sections: ["aria", "color-contrast"]
    priority: 1
  activeOverrides:
    - "accessibility.aria overrides code-philosophy.naming for button components"
```

#### Pattern-Based Circuit Breaker Initialization

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

## Lifecycle

| Step | Action | Responsibility |
|---|---|---|
| 1. **Created** | Written at pipeline start via `pipeline-init.ts` | Orchestrator |
| 2. **Updated** | Before each agent hand-off with `nextObjective` and relevant artifacts | Orchestrator |
| 3. **Heartbeat** | Updated with `pipelineHeartbeat` timestamp every time the file is written | Orchestrator |
| 4. **Read** | By each agent at startup (step 0 in their workflow) | Agent |
| 5. **Appended** | By Orchestrator after each agent completes (add to `agentHistory`, update `circuitBreaker`, update `agentOutputs`) | Orchestrator |
| 6. **Archived** | When the pipeline ends (by `pipeline-teardown.ts` — writes to `.opencode/pipeline-logs/`) | Orchestrator |
| 7. **Deleted** | After archival (by `pipeline-teardown.ts`) | Orchestrator |

---

## Stale Context Detection

If `agent-context.md` exists with `status: "running"` and `createdAt` is more than **1 hour old**:

- The pipeline is considered **STALE** (crashed/interrupted mid-pipeline)
- The Orchestrator MUST detect this in the pre-flight check (`pipeline-init.ts` already checks this)
- The Orchestrator MUST prompt the user before overwriting or cleaning up
- If the user approves cleanup: archive the stale context to `.opencode/pipeline-logs/stale-<pipelineId>/`, then proceed with a fresh pipeline

---

## Orchestrator Verification Steps

After receiving a valid agent output, the Orchestrator MUST:

1. Parse the structured output fields from the agent's report
2. Cross-reference `changedFiles` against actual disk state (using read/glob/grep)
3. Cross-reference `buildPassed`/`lintPassed` against raw output excerpts
4. Append the agent's results to `agentHistory` in `agent-context.md`
5. Update `circuitBreaker.counters` if the gate failed
6. Update `agentOutputs.<agent-name>` with the structured data
7. Save the updated `agent-context.md` with fresh `pipelineHeartbeat`
8. **Validate agent output contract**: Run `ts-node skills/scripts/orchestration/validate-output-contract.ts --agent-context=agent-context.md` to programmatically verify that each agent's structured output claims match reality (files exist, build/lint claims are consistent with output text, no path traversal in claimed paths)

---

## Related

For the complete schema definition, field types, validation rules, and lifecycle details, see:
📄 `skills/orchestration/references/agent-context-schema.md`