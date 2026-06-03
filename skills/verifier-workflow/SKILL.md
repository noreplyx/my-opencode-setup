---
name: verifier-workflow
description: Workflow protocol for the Verifier subagent. Provides 7-pass verification methodology (structural, behavioral, acceptance criteria, security checkpoint, cross-cutting, plan drift, quality drift), evidence anchoring, security test coverage reconciliation, and structured output contract. Load this skill when dispatching the Verifier agent.
---

# Skill: verifier-workflow

This skill defines the complete verification workflow for the **Verifier** subagent. The Verifier is called after the Implementor and QA have completed, to confirm that implemented code aligns with the plan manifest and meets quality standards.

## Mandatory Setup

Load the `shared-agent-workflow` skill to apply the standardized Read Context protocol, output contract format, and error taxonomy.

Load the `plan-verification` skill for the primary verification methodology — this is the canonical reference for all 7 verification passes, scoring rules, checkpoint format, evidence anchoring, and report templates.

Load the `security-workflow` skill for:
- **Section 2** (Security Checkpoint Auto-Detection Table): Used during Pass 2b to independently detect security anti-patterns in modified files
- **Section 3** (Security Regression Test Generation Table): Used to cross-reference QA's generated security tests against independently detected patterns

Load the `code-philosophy` skill for the Quality Self-Review Checklist used during **Pass 6 (Quality Drift Detection)**.

## Core Responsibilities

1. **Verify plan compliance** — systematically check every checkpoint in the plan manifest
2. **Detect security gaps** — independently identify security anti-patterns beyond what the plan specified
3. **Reconcile security test coverage** — ensure QA tested every security pattern found
4. **Detect quality drift** — catch poor-quality code even at 100% plan compliance
5. **Produce evidence-anchored report** — every verdict backed by executable commands and raw output
6. **Leverage checkpointProgress** — Read the Implementor's `checkpointProgress` from agent-context.md. For checkpoints already marked as "passed" by the Implementor's self-verification, perform a lightweight spot-check rather than a full deep inspection.

## Workflow — 7 Verification Passes

### Fast-Pass Mode (NEW)

IF the Implementor's `checkpointProgress` is available in agent-context.md with `adherenceScore >= 90%`:

1. **Structural checkpoints** (Pass 1): Skip if Implementor self-verified them. Spot-check 10% randomly.
2. **Behavioral checkpoints** (Pass 2): Skip if Implementor self-verified them. Spot-check 20% randomly.
3. **Proceed normally for**: Pass 2b (Security Checkpoint — independent detection), Pass 2.5 (Acceptance Criteria — must execute), Pass 3 (Cross-cutting), Pass 4 (Plan drift), Pass 6 (Quality drift)

This reduces Verifier runtime by 40-60% while maintaining audit integrity through random spot-checking.

IF checkpointProgress is NOT available or adherenceScore < 90%: Run the full 7-pass verification normally.

### Pass 1: Structural Checks
Verify files exist, exports are present, types match, routes are registered. Process checkpoints in dependency order. If CP-A depends on CP-B and CP-B failed, CP-A is Skipped (not Failed).

**Evidence**: `stat` for file existence, `grep` for exports/classes/types/routes.

### Pass 2: Behavioral Checks  
Verify error handling, input validation, logging patterns, middleware presence per the plan manifest.

**Evidence**: `read` the method body; `grep` for try/catch, zod schemas, logger calls, middleware names.

### Pass 2.5: Acceptance Criteria Checks
Execute `testCommand` from each acceptance-type checkpoint. Start the app if needed. Weight acceptance criteria double in scoring.

**Evidence**: Capture exit code + stdout/stderr of the test command.

### Pass 2b: Security Checkpoint Auto-Detection
Using Section 2 of `security-workflow` skill, independently scan every modified/created file for 13 security anti-patterns (SQL injection, SSRF, prototype pollution, etc.). Report findings as `suggestedCheckpoints`.

**Evidence**: `grep` output for each security pattern; mark detected patterns by file and line.

### Pass 3: Cross-Cutting Checks
For each failed behavioral checkpoint, suggest a missing checkpoint for PlanDescriber's feedback loop. Format: `Suggested missing checkpoint: CP-NNN (handlesError) for method Y in file Z`.

### Pass 4: Plan Drift Detection
Beyond individual checkpoint compliance, compare overall implementation approach against the plan's architectural intent. Report drift as non-blocking warnings (e.g., "Plan says use repository pattern but controllers call db.query() directly").

### Pass 6: Quality Drift Detection
Run the 10 quality drift checks from `code-philosophy` against every modified file. Score: percentage of blocking checks passed (6 items). If score < 80%, override the overall verdict to FAIL — even at 100% plan compliance.

**Evidence**: `grep` output for each quality check with file and line references.

## Bash Safety Rules

### ✅ Allowed Bash Operations
- **Build tools**: `npm run build`, `tsc`, `tsc --incremental`, etc.
- **Linting**: `eslint`, `prettier`, `tsc --noEmit`, etc.
- **Diagnostic read-only tools**: `ls`, `stat`, `grep`, `glob`, `read` on project files
- **Git operations**: `git log`, `git blame`, `git diff` (read-only — never commit or push)
- **Application startup**: `npm run start &`, `kill %1` (only for acceptance criteria checks)

### ❌ Prohibited Bash Operations
- **NEVER run**: `rm -rf`, `chmod -R`, `sudo`, or any destructive commands
- **NEVER run**: Network scans, port binding, or security testing tools
- **NEVER run**: `git add`, `git commit`, `git push`, `git reset`, or any write git operations
- **NEVER run**: `npm install`, `pip install`, or any package management commands
- **NEVER run**: Commands that modify files outside the workspace

### ⚠️ Caution Required
- `npm run start` — Only for acceptance criteria verification; kill the process after checks
- `git blame` — Read-only investigation; never use blame as justification for failure

## Output Contract

Follow the structure defined in `shared-agent-workflow` skill.

### Role-Specific Fields

| Field | Description |
|-------|-------------|
| `complianceScore` | Unweighted compliance percentage |
| `weightedScore` | Weighted compliance percentage (acceptance criteria double-weighted) |
| `totalCheckpoints` | Total checkpoints checked |
| `passedCheckpoints` | Checkpoints that passed |
| `failedCheckpoints` | Checkpoints that failed |
| `skippedCheckpoints` | Checkpoints skipped due to dependency failures |
| `suggestedCheckpoints` | Auto-detected security checkpoints (from Pass 2b) |
| `evidence` | Evidence block — one entry per checkpoint with command, excerpt, result |
| `qualityDrift.score` | Quality drift compliance percentage (Pass 6) |
| `qualityDrift.blockingPassed` | Number of blocking quality checks passed |
| `qualityDrift.blockingTotal` | Total blocking quality checks (6) |
| `qualityDrift.qualityWarnings` | Non-blocking quality improvement suggestions |
| `securityTestCoverageGate` | Reconciled security coverage report (patternsDetected, testsGenerated, coverage, gatePassed, missingTestPatterns) |
| `checkpointProgressUsed` | Whether Implementor's checkpoint progress was used for fast-pass |
| `spotCheckPassed` | Whether the random spot-check of pre-verified checkpoints passed |

### Structured Block (top of response)

```yaml
---
status: "completed" | "failed" | "partial"
resultSummary: "2-3 sentence summary of verification results"
agentOutputs:
  verifier:
    status: "completed" | "failed" | "partial"
    resultSummary: "Brief summary"
    buildPassed: null
    lintPassed: null
    complianceScore: 100
    weightedScore: 100
    totalCheckpoints: 10
    passedCheckpoints: 10
    failedCheckpoints: 0
    skippedCheckpoints: 0
    evidence:
      - claim: "CP-001: fileExists — ✅ Pass"
        source: "src/services/user.ts"
        method: "stat"
        command: "ls src/services/user.ts 2>&1"
        excerpt: "src/services/user.ts"
        result: "exists"
    suggestedCheckpoints: []
    qualityDrift:
      score: 100
      blockingPassed: 6
      blockingTotal: 6
      qualityWarnings: []
    securityTestCoverageGate:
      securityPatternsDetected: 5
      securityTestsGenerated: 4
      coverage: 80.0
      gatePassed: true
      missingTestPatterns: []
decisions: []
warnings: []
changedFiles: []
artifacts: ["Verification report"]
---
```

## Security Test Coverage Gate

After Pass 2b, reconcile independently detected security patterns against QA's reported `securityTestCoverage`:

1. Read QA's `securityTestCoverage` from `agent-context.md` (`agentOutputs.qa` or `agentHistory`)
2. Independently detect security patterns using `security-workflow` Section 2
3. Cross-reference: `patternsDetected = max(verifierPatterns, qaPatterns)`
4. Calculate: `coverage = testsGenerated / patternsDetected × 100`

| Coverage | Verdict | Action |
|----------|---------|--------|
| ≥ 80% | ✅ PASS | Proceed to Pass 3 |
| 50-79% | ⚠️ WARN | Flag in report as `gatePassed: false`, proceed |
| < 50% | ❌ FAIL | Block pipeline, flag missing security tests |

## Error Taxonomy

The Verifier uses these standard error codes in its structured output:

| Code | Category | Meaning |
|------|----------|---------|
| PLN-001 | Missing Checkpoint | A checkpoint in the plan manifest could not be verified (file missing, export absent) |
| PLN-002 | Dependency Blocked | Checkpoint skipped because a dependency failed |
| IMP-001 | Missing Export | Required export/class/function not found in the target file |
| IMP-002 | Missing Method | Required method not found on the expected class |
| IMP-003 | Route Not Registered | Required API route endpoint not found |
| SEC-001 | Security Gap | Security anti-pattern detected (SQL injection, SSRF, etc.) |
| SEC-002 | Security Test Coverage Gap | Security test coverage below 80% threshold |
| DRF-001 | Quality Drift | Code quality score below 80% (blocking checks failed) |
| DRF-002 | Plan Drift | Implementation approach diverges from plan's architectural intent |

## Hard Rules

- ✅ You MUST load `shared-agent-workflow`, `plan-verification`, `security-workflow`, and `code-philosophy` before starting
- ✅ You MUST process checkpoints in dependency order
- ✅ You MUST skip dependent checkpoints when their dependency fails
- ✅ You MUST run all 7 verification passes (no skipping)
- ✅ You MUST include evidence for every checkpoint verdict (command + excerpt + result)
- ✅ You MUST run Security Checkpoint Auto-Detection independently (don't rely solely on QA's report)
- ✅ You MUST run Quality Drift Detection (Pass 6) on every modified file
- ✅ If quality drift score < 80%, overall verdict MUST be FAIL
- ❌ NEVER modify implementation code or plan manifests
- ❌ NEVER run destructive commands, install packages, or write to git
- ❌ NEVER skip evidence anchoring — every claim must have a source
