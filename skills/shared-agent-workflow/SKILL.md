---
name: shared-agent-workflow
description: |
  Shared workflow protocol for all orchestration subagents. Use this skill at the START of every agent task to:
  1. Read and validate agent-context.md (pipeline state, circuit breaker, git state, prior agent history)
  2. Understand the structured output contract for your agent role
  3. Set up logging and error handling consistently
  
  This skill MUST be loaded by EVERY subagent (finder, plandescriber, implementor, fixer, qa, verifier, merge-coordinator, integrator, browser-tester, documentor) before performing any task-specific work.
  
  It eliminates ~30 lines of duplicated "Read Context" boilerplate from every agent instruction file.
---

# Shared Agent Workflow Protocol

This skill defines the standardized startup and shutdown workflow for ALL orchestration subagents. Always load this skill at the very beginning of your task, before any agent-specific work.

## Step 0: Validate & Read agent-context.md

### Purpose
Understand the pipeline's current state, what came before you, and what's expected next.

### Protocol

1. **Check if `agent-context.md` exists** in the workspace root
2. If it does NOT exist → continue with the context provided by the Orchestrator in the hand-off message
3. If it DOES exist → run the validation script:
   ```bash
   ts-node skills/scripts/orchestration/validate-context.ts --context=agent-context.md
   ```
4. **Validate the output**:
   - If `valid: false` → report the errors to the Orchestrator and STOP — do not proceed
   - If `valid: true` → proceed to read the file
5. **Read and extract** these fields from the YAML frontmatter:

```yaml
# ── Pipeline Identity ──
pipelineId:        # Unique pipeline ID for logging
feature:           # Feature name for context
pipelineType:      # full | quick | fixer-only | etc.
currentStep:       # Your agent's role name (confirmed by Orchestrator)
status:            # running | completed | failed | stale

# ── Agent History ──
agentHistory:
  - step:          # Prior agent that ran
    agent:         # Session ID
    result:        # completed | failed | partial
    summary:       # What they did
    decisions:     # Key decisions made
    warnings:      # Issues they flagged
    changedFiles:  # Files they modified
    artifacts:     # Outputs they produced

# ── Agent Outputs ──
agentOutputs:
  <agentName>:
    status:        # completed | failed | partial
    resultSummary: # What they produced
    buildPassed:   # true | false | null
    lintPassed:    # true | false | null

# ── Circuit Breaker ──
circuitBreaker:
  state:           # closed | open | half-open
  counters:        # build: 0, lint: 0, securityScan: 0, smokeTest: 0, verifier: 0
  thresholds:      # Maximum retries per gate (typically 3)

# ── Git State ──
gitState:
  branch:          # Current branch
  dirtyFiles:      # Files modified before this pipeline
  lastCommitSha:   # HEAD commit

# ── Next Objective ──
nextObjective:     # What the Orchestrator expects you to do
```

### What to Extract for Your Agent

Each agent extracts context relevant to its role:

| Agent           | Key Context to Extract from agentHistory                                       | Key Circuit Breaker Check                     |
|-----------------|--------------------------------------------------------------------------------|-----------------------------------------------|
| **Finder**      | Prior Finder results (avoid re-exploring)                                       | Not applicable (read-only)                     |
| **PlanDescriber** | Finder exploration, prior PlanDescriber revisions (v1, v2...)                 | Check failureSummary for why prior plans failed |
| **Implementor** | PlanDescriber decisions, prior Implementor attempts                             | build/lint counters — be careful if near limit  |
| **Fixer**       | QA/Verifier reports, prior Fixer attempts (critical for retries)               | verifier counter — last attempt awareness       |
| **QA**          | Implementor changedFiles, security scan results                                 | smokeTest counter                               |
| **Verifier**    | Implementor changedFiles, buildPassed/lintPassed, prior Verifier scores         | verifier counter — know re-verify count         |
| **MergeCoordinator** | Last set of Implementor changedFiles                                      | build counter — runs before build               |
| **Integrator**  | Implementor changedFiles, MergeCoordinator results                              | build counter — runs before build               |
| **BrowserTester** | Implementor changedFiles, QA results                                           | testing-related counters                        |
| **Documentor**  | Implementor changedFiles, PlanDescriber decisions                               | Not applicable (informational only)             |

### Stale Context Detection

If `status: "running"` and `createdAt` is more than 1 hour old:
- The pipeline is considered STALE (crashed/interrupted)
- Do NOT proceed — report to the Orchestrator and wait for instructions
- The Orchestrator will prompt the user before overwriting

## Step 1: Structured Output Contract

Every agent MUST return its results in a standardized structured format. The format has two parts:

### Part A: YAML Frontmatter (machine-readable)

Place this at the TOP of your response to the Orchestrator:

```yaml
---
status: "completed" | "failed" | "partial"
resultSummary: "<2-3 sentence summary of what was done>"
agentOutputs:
  <yourAgentName>:
    status: "completed" | "failed" | "partial"
    resultSummary: "<brief summary>"
    buildPassed: true | false | null
    lintPassed: true | false | null
    buildOutput: "<full stdout + stderr if build was run>"  # optional
    lintOutput: "<full stdout + stderr if lint was run>"     # optional
decisions:
  - what: "<key decision made>"
    why: "<rationale>"
    by_who: "<your agent name>"
warnings:
  - "<any non-blocking issues>"
changedFiles:
  - "<path/to/modified/file.ts>"
artifacts:
  - "<path/to/output/artifact>"
---
```

### Part B: Markdown Body (human-readable)

Below the frontmatter, include the detailed report in markdown.

### Role-Specific Additional Fields

| Agent           | Additional Fields in Structured Output                                          |
|-----------------|----------------------------------------------------------------------------------|
| **Implementor** | `selfReview` (confidence, securityItemsPassed, wiringManifest), `securitySelfReview` (passed, failures) |
| **Fixer**       | `rootCauseAnalysis` (classification, primaryCause, fixApplied, fixConfidence, crossModuleCheck) |
| **QA**          | `projectType`, `smokeTestPassed`, `testFramework`, `coverage`, `securityTestsGenerated` |
| **Verifier**    | `complianceScore`, `weightedScore`, `suggestedCheckpoints` |
| **MergeCoordinator** | `filesChecked`, `importIssues`, `typeIssues`, `blocking` |
| **Integrator**  | `wiringSummary` (barrelFilesUpdated, diRegistrationsAdded, routesAdded, importsFixed) |
| **PlanDescriber** | `manifestPath`, `manifestVersion`, `phases`, `estimatedEffort`, `riskLevel` |
| **Finder**      | `explorationCache` (used, lastCommitSha) |
| **BrowserTester** | `urlsVisited`, `bugsFound`, `testScriptsCreated` |
| **Documentor**  | `docsCreated`, `docsUpdated` |

## Step 2: Pipeline Heartbeat

After completing your task (before reporting back), if `agent-context.md` exists, update its `pipelineHeartbeat` timestamp. This prevents the stale context detector from triggering on long-running agents.

You do NOT need to write the file yourself — report the current timestamp in your structured output and the Orchestrator will update the heartbeat.

## Step 3: Error Handling & Taxonomy

If you encounter an error during execution:

1. **Classify the error** using this taxonomy:
   - `build_failure` — Compilation/type errors
   - `lint_failure` — Linting violations  
   - `import_resolution_error` — Import paths don't resolve
   - `type_mismatch` — Type/interface mismatches
   - `plan_omission` — Plan didn't specify what was needed
   - `implementation_error` — Code doesn't match plan intent
   - `edge_case_miss` — Missing edge case handling
   - `integration_mismatch` — Cross-module inconsistency
   - `environment_issue` — Missing tools, files, configs
   - `circuit_breaker_open` — Pipeline blocked by circuit breaker
   - `security_violation` — Security check failed
   - `output_contract_violation` — Agent output format invalid
   - `timeout` — Operation took too long
   - `unknown` — Unclassified error

2. **In your structured output**, add an `errors` field:
   ```yaml
   errors:
     - category: "build_failure"
       message: "TypeScript compilation failed in src/services/user.ts"
       source: "<your agent name>"
       recoverable: true
       details:
         errorCount: 3
         firstError: "Type 'string' is not assignable to type 'number'"
   ```

3. **Decide**: Is the error recoverable? If yes, try to fix it. If no, set `status: "failed"` and report to the Orchestrator.

## Output Contract Validation (Self-Check)

Before reporting back, verify your structured output contains:
- [ ] `status` field (completed/failed/partial)
- [ ] `resultSummary` field (2-3 sentences)
- [ ] `agentOutputs.<yourName>.status`
- [ ] `agentOutputs.<yourName>.resultSummary`
- [ ] `changedFiles` (list of files you modified/created)
- [ ] `artifacts` (list of produced outputs)
- [ ] `warnings` (any issues you encountered)

If any required field is missing, add it before reporting.

## Quick Reference for Agent-context.md Parsing

```typescript
// Conceptual pseudocode — your agent doesn't run this, but follows the same logic

// Step 1: Validate
const validation = await exec('ts-node skills/scripts/orchestration/validate-context.ts --context=agent-context.md');
if (!validation.valid) { /* STOP, report errors */ }

// Step 2: Read
const context = parseFrontmatter(readFile('agent-context.md'));

// Step 3: Extract what you need
const pipelineType = context.pipelineType;
const agentHistory = context.agentHistory;
const circuitBreaker = context.circuitBreaker;
const gitState = context.gitState;
const nextObjective = context.nextObjective;

// Step 4: Check for prior attempts of your role
const myPriorAttempts = agentHistory.filter(h => h.step === '<your agent name>');
const retryCount = myPriorAttempts.length;
const isReattempt = retryCount > 0;
```

## Step 0b: Dry-Run Mode (optional)

When the Orchestrator includes `--dry-run` in the hand-off message, your task changes from **execution** to **preview**:

### Dry-Run Rules
1. **Perform all analysis** — Read context, read files, trace imports, plan changes
2. **NEVER write files** — Do not create, modify, or delete any file
3. **NEVER run bash commands** — No build, no lint, no test
4. **Output a diff manifest** instead of implementation:

```yaml
---
status: "completed"
resultSummary: "Dry-run: Would create 2 files, modify 1 file"
dryRun:
  enabled: true
  wouldCreate:
    - "src/services/user.ts"
    - "src/controllers/user.ts"
  wouldModify:
    - "src/controllers/index.ts"
  wouldDelete: []
  estimatedLOC: 145
  planAdherence: 0.92
  risks:
    - "New dependency: zod@3.22 — verify bundle size impact"
  diffPreview: |
    --- a/src/controllers/index.ts
    +++ b/src/controllers/index.ts
    @@ -1,3 +1,4 @@
    +export * from './user.controller';
changedFiles: []
artifacts: ["Dry-run report"]
---
```

### When Dry-Run is Useful
- Before a complex implementation: see what will change before committing
- Before a Fixer cycle: see the proposed fix before applying it
- Before a PlanDescriber revision: see what the new plan would produce

## Step 0c: Reproduction Command Protocol

Every agent MUST include a `reproduction` field in their structured output when:
- A build, lint, or test command is run (pass or fail)
- A bug is discovered
- A deviation is found

### Format
```yaml
reproduction:
  command: "npm run build"
  expectedExitCode: 0
  actualExitCode: 2
  expectedOutput: "Build completed successfully"
  actualOutputSnippet: "src/services/user.ts:42:3 - error TS2322"
  environment:
    nodeVersion: "20.11.0"
    dependencies: ["express@4.18.2", "typescript@5.3.3"]
```

### Why This Matters
Without standardized reproduction commands, bugs can't be reproduced by other agents or across sessions. The reproduction command makes every failure **executable** rather than just **describable**.

### When to Include
| Scenario | Include reproduction? | Example |
|----------|----------------------|---------|
| Build passes | ✅ Yes (shows what command was run) | `reproduction: { command: "npm run build", expectedExitCode: 0, actualExitCode: 0 }` |
| Build fails | ✅ Yes (critical for debugging) | `reproduction: { command: "npm run build", expectedExitCode: 0, actualExitCode: 2, ... }` |
| Lint fails | ✅ Yes | `reproduction: { command: "npx eslint src/", expectedExitCode: 0, actualExitCode: 1 }` |
| Test fails | ✅ Yes | `reproduction: { command: "npm test", expectedExitCode: 0, actualExitCode: 1 }` |
| No command run | ⏭️ Skip | (omit the field entirely) |

### Storing Reproduction Commands
The Orchestrator will write reproduction commands to `.opencode/reproductions/<pipelineId>-<step>-<timestamp>.yaml` so they can be:
- Searched across sessions
- Replayed in CI
- Compared to find regressions

## Step 4: Error Reproduction Packets

When your agent encounters a **failure** (build error, test failure, unexpected exception), you MUST emit an Error Reproduction Packet in addition to your standard output.

### Format
Add an `errorReproduction` block to your structured output:

```yaml
errorReproduction:
  pipelineId: "<from agent-context.md>"
  failedStep: "<your agent name>"
  feature: "<from agent-context.md>"
  attemptNumber: <1-based retry count>
  symptom: "<one-line description of what went wrong>"
  reproduction:
    command: "npm run build"
    workingDir: "/home/oat/.config/opencode"
    expectedExitCode: 0
    actualExitCode: 2
    actualOutputSnippet: "src/services/user.ts:42:3 - error TS2322"
  inputState:
    files: ["src/services/user.ts", "src/types/user.ts"]
    gitHeadSha: "<from agent-context.gitState.lastCommitSha>"
    uncommittedChanges: true
  environment:
    nodeVersion: "<from node --version>"
    os: "linux"
    workspaceHash: "<sha256 of workspace structure>"
  context:
    planCheckpointsAtFailure: ["CP-003", "CP-005"]
    priorAgentResults:
      - step: "finder"
        result: "completed"
      - step: "plandescriber"
        result: "completed"
```

### When to Emit
| Situation | Emit errorReproduction? |
|-----------|------------------------|
| Build command returns non-zero | ✅ Yes |
| Lint command fails | ✅ Yes |
| Test suite fails | ✅ Yes |
| Unexpected file read/write error | ✅ Yes |
| Task completes successfully | ❌ No |
| Dry-run mode (no execution) | ❌ No |

### Why Error Packets Matter
1. **Cross-session error matching**: The Orchestrator can query `.opencode/errors/` for similar errors
2. **Reproducibility**: Every error has an executable command to reproduce it
3. **Debug hand-off**: When the Fixer receives an error packet, it can immediately run the reproduction command instead of reasoning from scratch
4. **Trend analysis**: Over time, error patterns emerge (e.g., "80% of build errors are in src/services/")

## Step 5: Git Checkpoint Protocol

After completing your task (if you modified files), indicate to the Orchestrator that a git checkpoint should be created:

```yaml
checkpoint:
  create: true
  message: "Implemented UserService with createUser and getUser"
  changedFiles:
    - "src/services/user.ts"
    - "src/controllers/user.ts"
```

The Orchestrator will then run:
```bash
ts-node skills/scripts/orchestration/pipeline-checkpoint.ts \
  --pipeline-id=<id> --step=<your-name> --session-id=<ses> \
  --feature=<feature> --message="<summary>"
```

This creates a lightweight git commit with a structured message that enables:
- `git log --grep="pipeline-checkpoint"` → see the full pipeline timeline
- `git diff <checkpoint-A>..<checkpoint-B>` → see exactly what each agent changed
- `git bisect` → identify which agent step introduced a regression

### Important Rules
- Checkpoints create non-push commits only (never pushed to remote)
- No checkpoint is created if no files changed
- Checkpoints use `--no-verify` to bypass git hooks (they're lightweight markers, not production commits)
- The parent commit SHA is recorded in every checkpoint message for traceability
