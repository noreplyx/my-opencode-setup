# Agent Calibration Database Schema

**File**: `.opencode/calibration/agents.yaml`

## Purpose

The calibration database tracks per-agent success rates across sessions,
enabling the Orchestrator to make smarter dispatch decisions. Without it,
every agent is treated equally regardless of track record.

## File Format

The file uses YAML with two top-level sections: `agents` and `orchestrator`.

## Schema

### `agents` (object)

Keyed by agent name (kebab-case). Each entry is an object:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `totalTasks` | number | ✅ | Total times this agent has been dispatched |
| `successfulTasks` | number | ✅ | Times the agent completed successfully |
| `failedTasks` | number | ✅ | Times the agent failed |
| `avgEffectiveness` | string | ✅ | One of: `good`, `ok`, `poor`, `unknown` |
| `lastTaskDate` | string / null | ✅ | ISO-8601 timestamp of last dispatch |
| `commonFailurePatterns` | string[] | ✅ | Recurring failure patterns observed |
| `strengths` | string[] | ✅ | Known strengths of this agent |

### Agent-Specific Fields

| Field | Required For | Description |
|-------|--------------|-------------|
| `buildRetries` | Implementor, Fixer, Integrator | Number of build retries across tasks |
| `lintRetries` | Implementor, Fixer, Integrator | Number of lint retries across tasks |
| `behavioralCheckpointsPerPlan` | PlanDescriber only | Average behavioral checkpoints per plan manifest |
| `acceptanceCriteriaPerPlan` | PlanDescriber only | Average acceptance criteria checkpoints per plan manifest |
| `wiringErrorsFixed` | Integrator only | Number of incorrect imports/wiring fixed across tasks |
| `barrelFilesUpdated` | Integrator only | Number of barrel file updates across tasks |
| `docTypesGenerated` | Documentor only | Map of doc types to count (inline, readme, changelog, api, migration) |
| `docAccuracyScore` | Documentor only | Self-reported accuracy (1-10) average across tasks |

### `orchestrator` (object)

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `totalPipelines` | number | ✅ | Total pipelines orchestrated |
| `successfulPipelines` | number | ✅ | Pipelines that passed all gates |
| `failedPipelines` | number | ✅ | Pipelines that failed |
| `pipelineSelectionAccuracy` | number | ✅ | Percentage (0-100) of correct pipeline type selections |
| `pipelineSelectionAccuracyByType` | object | ❌ | Map of task type → accuracy percentage (NEW) |
| `lastPipelineDate` | string / null | ✅ | ISO-8601 timestamp of last pipeline |
| `commonSelectionErrors` | string[] | ✅ | Recurring pipeline selection mistakes |
| `circuitBreakerActivations` | number | ❌ | Total number of circuit breaker activations (NEW) |
| `avgPipelineDuration` | number | ❌ | Average pipeline duration in minutes (NEW) |
| `avgTokensPerPipeline` | number | ❌ | Average token usage per pipeline (NEW) |

## Lifecycle

1. **Created**: On first pipeline run (by `update-calibration.ts`)
2. **Read**: Before each pipeline dispatch (by Orchestrator via `--read` flag)
3. **Updated**: After each pipeline completes (by `pipeline-teardown.ts` calling `update-calibration.ts`)
4. **Never deleted**: Persistent across all sessions

## Dispatch Decision Rules

The Orchestrator uses calibration data to make better dispatch decisions:

1. **Before dispatching an agent**: Check `failedTasks / totalTasks` ratio
   - If ratio > 0.33 (33% failure rate): **warn the user** and ask if they want a different agent
2. **If `commonFailurePatterns` match the current task**: Add explicit guardrails in the hand-off prompt
3. **If `avgEffectiveness` is "poor" for 3 consecutive sessions**: Flag for user review
4. **If `buildRetries` is high (> 3 per task on average)**: Consider adding more pre-build validation steps

### NEW: Pipeline Selection Accuracy Tracking

The Orchestrator now tracks accuracy **per task type**:

```yaml
orchestrator:
  totalPipelines: 12
  successfulPipelines: 9
  failedPipelines: 3
  pipelineSelectionAccuracy: 75
  pipelineSelectionAccuracyByType:  # NEW
    new-feature-known: 100
    new-feature-unknown: 66
    bug-fix-known-cause: 100
    refactor: 50
  lastPipelineDate: "2026-05-19T10:30:00Z"
  commonSelectionErrors:
    - "Selected 'full' pipeline for 'refactor' when 'standard' would have sufficed (no Finder needed)"
  circuitBreakerActivations: 2  # NEW
  avgPipelineDuration: 14  # NEW — minutes
  avgTokensPerPipeline: 85000  # NEW
```

**How to update**: After each pipeline, the Orchestrator records:
- `taskType` from the classification
- Whether the selected pipeline type was correct (`pipelineSelectionCorrect: true/false`)
- `update-calibration.ts` appends to `pipelineSelectionAccuracyByType[taskType]`

**Usage**: Before selecting a pipeline, the Orchestrator checks:
- If `pipelineSelectionAccuracyByType[taskType]` exists and is < 80% → warn user
- If no history for this task type → fall back to the lookup table (default behavior)

## Examples

### Integrator
```yaml
agents:
  integrator:
    totalTasks: 3
    successfulTasks: 3
    failedTasks: 0
    avgEffectiveness: "good"
    lastTaskDate: "2026-05-19T10:30:00Z"
    commonFailurePatterns:
      - "Misses DI registration for classes without @Injectable decorator"
    strengths:
      - "Accurate barrel file updates"
      - "Correct route wiring"
    buildRetries: 0
    lintRetries: 0
    wiringErrorsFixed: 2
    barrelFilesUpdated: 4
```

### Documentor
```yaml
agents:
  documentor:
    totalTasks: 2
    successfulTasks: 2
    failedTasks: 0
    avgEffectiveness: "good"
    lastTaskDate: "2026-05-19T10:30:00Z"
    commonFailurePatterns: []
    strengths:
      - "Consistent JSDoc formatting"
      - "Accurate changelog categorization"
    docTypesGenerated:
      inline: 4
      changelog: 2
      readme: 1
    docAccuracyScore: 9
```

## Script Access

- **Read calibration**: `ts-node skills/scripts/orchestration/update-calibration.ts --read`
- **Update agent**: `ts-node skills/scripts/orchestration/update-calibration.ts --agent=<name> --success=true [--build-retries=N] [--failure-pattern="..."] [--wiring-errors-fixed=N] [--barrel-files-updated=N]`
- **Update orchestrator**: `ts-node skills/scripts/orchestration/update-calibration.ts --agent=orchestrator --success=true [--failure-pattern="..."] [--task-type=<type>] [--pipeline-duration-min=N] [--circuit-breaker-activation]`
