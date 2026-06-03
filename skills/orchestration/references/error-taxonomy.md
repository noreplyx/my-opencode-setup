# Error Taxonomy

## Unified Error Taxonomy

All pipeline errors are now standardized across all agents using the canonical `PipelineError` type defined in `unified-pipeline-error-schema.ts`. This replaces the previous stringly-typed error classifications.

### Error Code Categories

| Prefix | Category | Example |
|---|---|---|
| PLN | Plan | PLN-001: Missing checkpoint |
| IMP | Implementation | IMP-001: Missing export |
| INT | Integration | INT-001: Broken import |
| ENV | Environment | ENV-001: Missing tool |
| SEC | Security | SEC-001: Critical vulnerability |

---

## Fixer Classification → Error Code Mapping

| Fixer Classification | Mapped Error Code(s) |
|---|---|
| plan-omission | PLN-001 or PLN-002 |
| implementation-error | IMP-001, IMP-002, or IMP-003 |
| edge-case-miss | IMP-004 or IMP-005 |
| integration-mismatch | INT-001, INT-002, or INT-003 |
| environment-issue | ENV-001, ENV-002, or ENV-003 |

---

## Usage

```bash
# Look up an error code
ts-node skills/scripts/orchestration/unified-pipeline-error-schema.ts --lookup=IMP-001

# Validate an error object
ts-node skills/scripts/orchestration/unified-pipeline-error-schema.ts --validate

# Classify a fixer root cause
ts-node skills/scripts/orchestration/unified-pipeline-error-schema.ts --classify="Missing export in user.ts" --fixer-classification=implementation-error
```

---

## Output Verification

### Structured Output Enforcement

Every subagent output MUST be validated against the structured output contract before the Orchestrator considers the task complete. Use the validation script:

```bash
# Validate a single agent output file
ts-node skills/scripts/orchestration/validate-output-contract.ts --file=<path-to-agent-output>

# Validate all agent outputs in agent-context.md
ts-node skills/scripts/orchestration/validate-output-contract.ts --pipeline

# Check against a specific agent schema
ts-node skills/scripts/orchestration/validate-output-contract.ts --agent=fixer
```

The validator checks:
1. YAML frontmatter is parseable
2. All required fields are present for the agent type
3. Field types are correct (boolean, string, array, null)
4. Enhanced fields (rootCauseAnalysis, selfReview, knowledgeGraph) match their schemas

### Rejection Protocol

If validation fails (exit code != 0):

1. **Reject the output**: Do NOT update `agent-context.md` with invalid data
2. **Report to agent**: Send the validation errors back to the agent with clear instructions on what's missing
3. **One retry**: Allow the agent one attempt to fix the output format
4. **Escalate**: If the agent fails to produce valid output twice, report to user

### Automated Output Contract Validation

After every agent hand-off, the Orchestrator MUST run automated output contract validation as a gate:

1. After the agent returns its structured output, immediately run:
   ```bash
   ts-node skills/scripts/orchestration/validate-output-contract.ts --pipeline
   ```
2. If exit code is 0 (valid): Proceed — all output fields are correctly formatted
3. If exit code is not 0 (invalid):
   - **Reject the output**: Do NOT update `agent-context.md`
   - **Send errors back**: Include the validation error messages in the hand-off
   - **One retry**: Allow the agent one attempt to fix the output format
   - **Escalate**: If the agent fails twice, report to the user with the validation failures
4. This validation is MANDATORY and cannot be skipped

---

## Standardized Error Format (All Agents)

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

| Code | Meaning | Category |
|---|---|---|
| `BUILD_FAILED` | TypeScript/Webpack/Vite compilation error | Implementation |
| `LINT_FAILED` | ESLint/Prettier style violation | Implementation |
| `TEST_FAILED` | Unit/integration test assertion failure | QA |
| `SMOKE_FAILED` | Application failed to start/boot | QA |
| `SECURITY_HIGH` | npm audit High severity vulnerability | Security |
| `SECURITY_CRITICAL` | npm audit Critical severity vulnerability | Security |
| `SECRETS_FOUND` | Hardcoded credentials detected | Security |
| `VERIFIER_LOW_SCORE` | Compliance score below 80% threshold | Verification |
| `IMPORT_MISMATCH` | Cross-file import path or symbol mismatch | Integration |
| `TYPE_MISMATCH` | Type signature mismatch between modules | Integration |
| `MISSING_EXPORT` | Expected export not found in module | Implementation |