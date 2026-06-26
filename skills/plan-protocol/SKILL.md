---
name: plan-protocol
description: >-
  Create, read, verify, understand, update, and diff structured plans
  conforming to the plan-protocol-schema. The schema defines checkpoints
  with acceptance criteria, security concerns, dependency graphs, blockers,
  and progress tracking. Create produces JSON+Markdown from user intent.
  Read renders plan JSON as Markdown. Verify validates plans for schema
  conformance, dependency integrity, ID uniqueness, and semantic quality
  (--strict). Understand analyzes plans for execution order, critical path,
  parallel groups, security context, and progress. Update modifies plans
  in-place (add/remove/reorder checkpoints, set AC status, manage blockers).
  Diff compares two plan versions. Schema displays the full schema reference
  with field descriptions, relationships, constraints, and allowed values.
  Triggers on: "create a plan", "explain the plan", "break this down",
  "what are the steps", "define acceptance criteria", "security review",
  "implementation plan", "read the plan", "show me the plan",
  "validate the plan", "verify the plan", "understand the plan",
  "analyze the plan", "interpret the plan", "track progress",
  "checkpoint status", "what does this plan mean",
  "how do I execute this plan", "plan analysis", "execution order",
  "critical path", "plan summary", "update plan", "modify plan",
  "add checkpoint", "remove checkpoint", "reorder checkpoints",
  "compare plans", "plan diff", "plan version diff",
  "plan schema", "schema reference", "what fields are in a plan",
  "plan structure", "plan format".
  Use for multi-phase plans requiring structured review gates.
  Do NOT use for simple single-step tasks or code generation requests.
---

# Plan Protocol

Create, read, verify, understand, update, and diff structured plans conforming to the [plan-protocol-schema](references/plan-protocol-schema.json). The schema defines a JSON format for multi-checkpoint implementation plans with acceptance criteria, security concerns, dependency graphs, blockers, and progress tracking. Output is both machine-readable (JSON) and human-readable (Markdown).

## Capabilities

This skill supports seven operations:

| Capability | Description | Command |
|---|---|---|
| **Create** | Produce a plan JSON + Markdown from user intent | Follow the Create workflow below, or scaffold with `bun run create -- "Title" "Description" "Overview" plan.json [N]` where N is checkpoint count (default 3). Supports `--ac` for custom acceptance criteria. Run from skill directory. |
| **Read / Render** | Parse an existing plan JSON and display as full Markdown | `bun run read -- plan.json` (run from skill directory) |
| **Verify** | Validate a plan JSON for schema conformance, dependency integrity, ID uniqueness, and semantic quality | `bun run validate -- plan.json` or `bun run validate -- --strict plan.json` (run from skill directory) |
| **Understand** | Analyze a plan for execution order, critical path, parallel groups, security context, and progress | `bun run read -- --understand plan.json` (run from skill directory) |
| **Understand (JSON)** | Same analysis as structured JSON for programmatic consumption | `bun run read -- --json plan.json` (run from skill directory) |
| **Update** | Modify a plan in-place (add/remove/reorder checkpoints, set AC status, manage blockers). Supports `--dry-run` to preview changes. | `bun run update -- plan.json <command> [args]` (run from skill directory) |
| **Update (strict)** | Same as Update but with strict semantic validation | `bun run update -- --strict plan.json <command> [args]` (run from skill directory) |
| **Diff** | Compare two plan versions for changes | `bun run diff -- plan-a.json plan-b.json` (run from skill directory) |
| **Schema** | Display the full schema reference with field descriptions, relationships, constraints, and allowed values | `bun run read -- --schema` (run from skill directory) |
| **Help** | Show usage info for any script | `bun run <cmd> -- --help` |

## Output Format

Every plan description MUST produce two outputs. The JSON is the **canonical** output — the Markdown is derived from it, not the other way around. Always write the JSON first, validate it, then generate the Markdown from the validated JSON.

1. **JSON** — Structured data that MUST be valid against `~/.config/opencode/skills/plan-protocol/references/plan-protocol-schema.json`
2. **Markdown** — Human-readable checklist derived from the validated JSON

### Markdown Template

Use this exact structure for the Markdown output:

```markdown
# Plan: [title]

**Description:** [description]

**Overview:** [overview]

---

## Checkpoints

### [CP-01] [checkpoint title] ✅ (N/N ACs, N SCs)

**Description:** [checkpoint description]

**Dependencies:** [list or "None"]

**Blockers:**
- 🚫 [blocker description]

**Acceptance Criteria:**
- ✅ [AC-01-01] [criterion description] [passed] — *Verify: [verification method]*
- ⬜ [AC-01-02] [criterion description] — *Verify: [verification method]*
- ❌ [AC-01-03] [criterion description] [failed] — *Verify: [verification method]*
- 🚫 [AC-01-04] [criterion description] [blocked] — *Verify: [verification method]*

**Security Concerns:**
- [SC-01] [severity] [concern description]
  - **Mitigation:** [mitigation]

**Security Concerns (AC-01-01):**
- [SC-01-01] [severity] [concern description]
  - **Mitigation:** [mitigation]

---

### [CP-02] [checkpoint title]

...

## Summary

- **Total Checkpoints:** [N]
- **Total Acceptance Criteria:** [N]
- **Total Security Concerns:** [N]
- **Critical Concerns:** [N]
- **High Concerns:** [N]
- **Medium Concerns:** [N]
- **Low Concerns:** [N]
```

---

## Create Workflow

Follow these steps in order to create a new plan:

### Step 1: Understand the Plan Context

Ask clarifying questions if the user's request is ambiguous. Determine:
- What is being built, changed, or migrated?
- What are the goals and constraints?
- Who are the stakeholders?
- What is the timeline or priority?

### Step 2: Decompose into Checkpoints

Break the plan into sequential checkpoints. Each checkpoint must be:
- **Independently verifiable** — can be tested/validated on its own
- **Ordered by dependency** — later checkpoints depend on earlier ones
- **Single implementation cycle** — sized for one focused work session (not a multi-week phase)
- **Decomposition heuristics:**
  - One checkpoint per architectural layer (DB to API to UI)
  - One checkpoint per independent concern (auth separate from CRUD)
  - Size for ~1 focused work session, not multi-week phases
  - If a checkpoint has >5 acceptance criteria, consider splitting it

**Parallel checkpoints:** When scaffolding with `bun run create`, prefix a checkpoint description with `~` to make it independent (no dependency on the prior checkpoint). Example:
```
bun run create -- "My API" "Build an API" "Full plan" plan.json "Setup" "~Auth" "Core"
```
This creates CP-01 (Setup) with no deps, CP-02 (Auth) with no deps (parallel to CP-01), and CP-03 (Core) depending on CP-02.

### Step 3: Define Acceptance Criteria

For each checkpoint, define 1+ acceptance criteria. Each criterion must be:
- **Objectively verifiable** — not subjective ("looks good") but testable ("test passes", "field exists")
- **Include a verification method** — how to check it (test command, code review, manual inspection, lint rule)
- **Independent** — each criterion tests one thing
- **SMART criteria guidance:**
  - **S**pecific: "Login returns JWT" not "Login works"
  - **M**easurable: "Response time <200ms" not "Fast"
  - **A**chievable: within scope of the checkpoint
  - **R**elevant: directly tests the checkpoint purpose
  - **T**estable: has a concrete verification method
- **Good:** "POST /api/register with valid email+password returns 201 with user ID"
- **Bad:** "Registration works" (subjective, no verification method)

### Step 4: Identify Security Concerns

For each checkpoint and each acceptance criterion, identify relevant security concerns:
- **Per checkpoint** — architectural or design-level risks (e.g., "this component handles PII")
- **Per criterion** — implementation-level risks (e.g., "this API endpoint needs input validation")
- Classify severity: `critical`, `high`, `medium`, `low`
- Include a mitigation suggestion for each concern
- **Common security concern categories (checklist):**
  - Authentication/Authorization bypass
  - Input validation / injection (SQL, XSS, command)
  - Sensitive data exposure (PII, secrets, credentials)
  - Rate limiting / abuse prevention
  - Mass assignment / privilege escalation
  - Insecure direct object references (IDOR)
  - Error message information leakage
  - Dependency vulnerabilities

### Step 5: Confirm with User

Present the checkpoints, acceptance criteria, and security concerns to the user for confirmation before producing the final output. Ask if the decomposition is correct, if any checkpoints are missing, or if the security concerns need adjustment.

Use the `question` tool to present the plan summary and ask for confirmation. Example:

```
Question: "Here is the plan I've drafted for [title]:

Checkpoints:
- CP-01: [title] — [N] acceptance criteria, [N] security concerns
- CP-02: [title] — [N] acceptance criteria, [N] security concerns

Does this look correct? Shall I proceed to generate JSON + Markdown?"
Options:
  - "Yes, proceed" — continue to Step 6
  - "Modify" — capture the user's changes and iterate
  - "Cancel" — discard the plan
```

If the user chooses "Modify", update the affected checkpoints/ACs/SCs and re-confirm before proceeding.

### Step 6: Output JSON + Markdown

1. **Write the JSON output** — produce the full JSON object conforming to `~/.config/opencode/skills/plan-protocol/references/plan-protocol-schema.json`
    - To quickly scaffold a skeleton plan, run:
      ```
       bun run create -- "Plan Title" "Description" "Overview" plan.json 5
      ```
       (Run from the skill directory, or use `bun --cwd <skill-dir> run create -- ...`)
       The last argument is the number of checkpoints (default 3).
       Then edit the generated `plan.json` with your checkpoints, acceptance criteria, and security concerns.
       **Note:** The scaffolded output uses generic descriptions. You MUST edit each checkpoint's title, description, ACs, and SCs with concrete content before presenting the plan. The scaffold passes `--strict` validation but is not production-ready.
    - To scaffold with custom acceptance criteria for the last checkpoint, use `--ac`:
      ```
      bun run create -- "Login Feature" "Add user login" "JWT-based login" plan.json "Login Endpoint" --ac "Returns JWT on valid credentials::curl POST /login; assert 200 with token" --ac "Rejects invalid password::curl POST /login with wrong password; assert 401"
      ```
      The `--ac` flag is repeatable. Each value uses format `"description::verification_method"` or just `"description"` (uses default verification method). Custom ACs are applied to the last checkpoint only.
    2. **Validate the JSON** — run a programmatic validation check against the schema before proceeding (strict mode is enabled by default):
       ```
       bun run validate -- --strict plan.json
       ```
      (Run from the skill directory, or use `bun --cwd <skill-dir> run validate -- plan.json`)
   3. **Fix if invalid** — if validation fails, correct the JSON and re-validate until it passes
   4. **Derive the Markdown** — generate the Markdown summary from the validated JSON by running:
     ```
     bun run read -- plan.json > plan.md
     ```
     (Run from the skill directory, or use `bun --cwd <skill-dir> run read -- plan.json > plan.md`)

---

## Render Workflow

To render an existing plan JSON as human-readable Markdown:

1. Ensure the plan JSON file exists and is valid
2. Run:
   ```
   bun run read -- plan.json
   ```
   (Run from the skill directory, or use `bun --cwd <skill-dir> run read -- plan.json`)
3. The script outputs the full Markdown checklist to stdout. Redirect to a file if needed:
   ```
   bun run read -- plan.json > plan.md
   ```

The `read-plan.ts` script automatically validates the plan before rendering. Use `--force` to render even if validation fails (useful for debugging malformed plans).

### No-Emoji Mode

For environments that don't support emoji rendering (e.g., plain text terminals, CI logs), use `--no-emoji`:

```
bun run read -- --no-emoji plan.json
bun run read -- --summary --no-emoji plan.json
```

### Force Mode

To render a plan even if it fails validation (useful for debugging malformed plans):

```
bun run read -- --force plan.json
```

This replaces emoji icons with text labels: `[done]`, `[pending]`, `[fail]`, `[BLOCKED]`.

### Summary / Analysis Mode

To get a concise analysis summary instead of the full Markdown render:

```
bun run read -- --summary plan.json
bun run read -- --analyze plan.json
```

Both flags are equivalent. This outputs the Plan Analysis format (execution order, critical path, parallel groups, severity summary, progress with real AC status, and blockers).

### Understand Mode

The `--understand` flag is a first-class capability that analyzes a plan's structure and execution context:

```
bun run read -- --understand plan.json
```

This produces the same analysis output as `--summary`/`--analyze` (execution order, critical path, parallel groups, security context, progress), but is semantically distinct — it represents the "Understand" workflow rather than just a summary. Use `--understand` when the user asks to "understand", "interpret", or "make sense of" a plan.

### Schema Reference Mode

To display the full plan protocol schema reference with field descriptions, relationships, constraints, and allowed values:

```
bun run read -- --schema
```

This outputs a comprehensive Markdown document covering:
- Root structure (title, description, overview, version, timestamps, checkpoints)
- Checkpoint fields (id, title, description, dependencies, acceptance_criteria, security_concerns, blockers)
- Acceptance criterion fields (id, description, verification_method, security_concerns, status)
- Security concern fields (id, description, severity, mitigation)
- Blocker fields (reason, created_at, resolved)
- ID naming conventions (CP, AC, SC patterns)
- Validation rules
- CLI tools reference

### JSON Analysis Mode

To get the same analysis as structured JSON (for programmatic consumption by other tools or AI agents):

```
bun run read -- --json plan.json
```

This outputs the `AnalysisResult` object as JSON with fields: `executionOrder`, `criticalPath`, `parallelGroups`, `severityCounts`, and `criticalHighSCs`.

---

## Verify Workflow

To verify a plan JSON for correctness:

1. Run the validator:
   ```
   bun run validate -- plan.json
   ```
   (Run from the skill directory, or use `bun --cwd <skill-dir> run validate -- plan.json`)
2. The validator checks:
   - **Schema conformance** — all required fields, types, patterns, and enum values (via `ajv` against the JSON Schema)
   - **Checkpoint ID uniqueness** — no duplicate CP IDs
   - **Dependency reference integrity** — all `dependencies` values reference existing checkpoint IDs
   - **Dependency ordering** — checkpoints that appear as dependencies must appear earlier in the array
   - **Circular dependency detection** — no cycles in the dependency graph (e.g., CP-02 → CP-03 → CP-02)
   - **AC ID uniqueness** — no duplicate acceptance criterion IDs across all checkpoints
   - **SC ID uniqueness** — no duplicate security concern IDs across all checkpoints and acceptance criteria
3. Exit code 0 means valid; exit code 1 means invalid (errors printed to stderr)

### Strict Mode

For additional semantic quality checks, use `--strict`:

```
bun run validate -- --strict plan.json
```

Strict mode adds:
- **Subjective language detection** — flags AC descriptions containing "looks good", "should work", "seems correct", etc.
- **Placeholder detection** — flags descriptions, verification methods, and mitigations that are still generic placeholders
- **Minimum length checks** — verification methods and mitigations must be at least 10 characters (concrete commands, not "Check" or "Fix it")

### Running Tests

Tests are in `tests/validate-plan.test.ts`. Run with:
```
bun test
```
(Run from the skill directory, or use `bun --cwd <skill-dir> test`)

The test suite covers: valid plan acceptance, missing required fields, empty checkpoints, duplicate IDs (CP/AC/SC), dangling dependencies, circular dependencies, invalid severity enums, missing verification methods, ID pattern violations, additional properties rejection, AC status field, checkpoint blockers, strict semantic validation, analyzePlan, renderCheckpoint with status, and diffPlans.

### Prerequisites

Before using this skill for the first time, install dependencies:
```
bun install
```
(Run from the skill directory, or use `bun --cwd <skill-dir> install)

---

## Update Workflow

Use this workflow to modify an existing plan in-place without recreating it from scratch.

### Commands

| Command | Description | Example |
|---|---|---|
| `add-cp <title> [description] [--after CP-ID]` | Add a new checkpoint after the given CP-ID (or at end if omitted). Dependencies default to the previous checkpoint. | `bun run update -- plan.json add-cp "Rate Limiting" "Add rate limiting middleware" --after CP-02` |
| `remove-cp <CP-ID>` | Remove a checkpoint and all its ACs/SCs. Fails if other checkpoints depend on it. | `bun run update -- plan.json remove-cp CP-03` |
| `reorder <CP-ID> <new-index>` | Move a checkpoint to a new position (0-based). | `bun run update -- plan.json reorder CP-03 1` |
| `set-status <CP-ID> <AC-ID> <status>` | Set an AC status: `pending`, `passed`, `failed`, `blocked` | `bun run update -- plan.json set-status CP-01 AC-01-01 passed` |
| `add-blocker <CP-ID> <reason>` | Add a blocker to a checkpoint. | `bun run update -- plan.json add-blocker CP-02 "Waiting for API key"` |
| `remove-blocker <CP-ID> <index>` | Remove a blocker by index (0-based). | `bun run update -- plan.json remove-blocker CP-02 0` |
| `set-title <new-title>` | Update the plan title. | `bun run update -- plan.json set-title "My Revised Plan"` |
| `set-description <new-description>` | Update the plan description. | `bun run update -- plan.json set-description "Revised description"` |
| `set-overview <new-overview>` | Update the plan overview. | `bun run update -- plan.json set-overview "Revised overview"` |

The update script automatically re-validates the plan after each modification and warns if validation fails.

### Dry-Run Mode

To preview changes without writing to the file, use `--dry-run`:

```
bun run update -- --dry-run plan.json add-cp "Rate Limiting"
bun run update -- --dry-run plan.json set-status CP-01 AC-01-01 passed
```

Dry-run mode shows the resulting JSON on stdout without modifying the file. Combine with `--strict` for full validation preview:

```
bun run update -- --dry-run --strict plan.json add-cp "Rate Limiting"
```

### Strict Mode

For additional semantic quality checks during updates, use `--strict`:

```
bun run update -- --strict plan.json add-cp "Rate Limiting"
```

Strict mode adds the same checks as `bun run validate -- --strict`: subjective language detection, placeholder detection, and minimum length checks on verification methods and mitigations.

---

## Diff Workflow

Use this workflow to compare two plan versions and see what changed.

```
bun run diff -- plan-v1.json plan-v2.json
```

The diff output shows:
- **Added checkpoints** — checkpoints present in v2 but not v1
- **Removed checkpoints** — checkpoints present in v1 but not v2
- **Modified checkpoints** — changes to title, description, dependencies, ACs, AC status, and security concerns (SCs at both checkpoint and AC level)
- **Progress summary** — overall AC pass rate change

Both plans are validated before diffing. If either plan fails validation, the diff is rejected with error details.

---

## Understand Workflow

Use this workflow when you need to interpret an existing plan for execution, track progress, or analyze its structure.

### Step 1: Parse the Plan Structure

Read the plan JSON and extract:
- **Title, description, overview** — for high-level context
- **Checkpoints array** — build an in-memory list of all CPs with their IDs, titles, descriptions, dependencies, ACs, SCs, statuses, and blockers
- **Dependency graph** — map each CP ID to its list of dependency CP IDs

### Step 2: Analyze Dependencies

Determine the execution order and parallelism:

1. **Topological sort** — process checkpoints in dependency order (dependencies first)
2. **Identify parallelizable groups** — checkpoints that share the same dependencies but don't depend on each other (e.g., CP-02 and CP-03 both depend on CP-01 but not on each other) can be worked on in parallel
3. **Identify critical path** — the longest chain of sequential dependencies (e.g., CP-01 to CP-02 to CP-04 is longer than CP-01 to CP-03 to CP-04); this determines the minimum timeline

### Step 3: Extract Security Context

Collect all security concerns across the plan:

1. Aggregate all SCs from all checkpoints and acceptance criteria
2. Group by severity:
   - **Critical/High** — blockers; must be addressed before or during implementation
   - **Medium/Low** — advisories; should be addressed but don't block
3. Map each SC to its parent (checkpoint or AC) for context during execution

### Step 4: Track Progress

Maintain a status map for execution tracking:

1. Each AC starts as `pending`
2. As work is done, mark ACs as `passed` or `failed` using `bun run update -- plan.json set-status <CP-ID> <AC-ID> <status>`
3. A checkpoint is **complete** only when ALL its ACs are `passed`
4. A checkpoint is **blocked** if it has blockers or any dependency checkpoint is not yet complete
5. Report progress concisely using `bun run read -- --summary plan.json`

### Step 5: Security-Aware Execution

Before implementing any checkpoint:

1. Review the checkpoint's own SCs and the SCs of each AC
2. Adjust implementation decisions to satisfy mitigations
3. If a mitigation cannot be implemented (e.g., rate limiting requires infrastructure not yet available), flag it as an escalation
4. After implementation, verify that each AC's verification method passes

### Plan Analysis Output Format

When the user asks to "understand", "analyze", or "interpret" a plan, produce this structured output:

```markdown
## Plan Analysis: [title]

**Execution Order:** CP-01 → [CP-02, CP-03] (parallel) → CP-04
**Critical Path:** CP-01 → CP-02 → CP-04 (3 steps)
**Parallelizable Groups:** CP-02, CP-03 (both depend on CP-01)

**Security Context:**
- Critical SCs: [N] — [list IDs and brief descriptions]
- High SCs: [N] — [list IDs and brief descriptions]
- Medium SCs: [N]
- Low SCs: [N]

**Progress:**
- ✅ CP-01: 3/3 ACs passed
- ⬜ CP-02: 1/3 ACs passed
- 🚫 CP-03: 0/2 ACs passed — 1 blocker(s)

**Overall:** 4/8 ACs passed, 0 failed, 0 blocked

**Blockers:**
- 🚫 CP-03: Waiting for API key
```

To generate this programmatically, use understand mode:
```
bun run read -- --understand plan.json
```

For structured JSON output (parsable by other tools or AI agents):
```
bun run read -- --json plan.json
```

### Hard Rules for Understand

- MUST analyze dependencies before determining execution order
- MUST NOT mark a checkpoint complete until all its ACs are verified as passed
- MUST surface critical/high SCs before starting implementation of the affected checkpoint
- MUST report blockers (unmet dependencies) when asked for status
- MUST NOT skip security context extraction — always aggregate SCs before execution
- MUST use the `update` command to set AC statuses as work progresses, not manually edit the JSON

---

## Hard Rules

- MUST output JSON that is valid against `~/.config/opencode/skills/plan-protocol/references/plan-protocol-schema.json` — validate programmatically before presenting to the user
- MUST NOT output JSON that fails schema validation; fix until it passes
- MUST include at least one acceptance criterion per checkpoint
- MUST include security concerns for every checkpoint that handles sensitive data, authentication, authorization, or external input
- MUST include a verification method for every acceptance criterion
- MUST NOT skip the Markdown summary — both outputs are required
- MUST NOT include acceptance criteria that are subjective or unverifiable
- MUST order checkpoints by dependency (no circular dependencies)
- MUST explicitly set `dependencies: []` for checkpoints with no dependencies (do not omit the field)
- MUST use the exact severity enum values: `critical`, `high`, `medium`, `low`
- MUST NOT have duplicate checkpoint IDs
- MUST NOT have duplicate acceptance criterion IDs across the entire plan
- MUST NOT have duplicate security concern IDs across the entire plan
- MUST NOT have dangling dependency references (every dependency must point to an existing checkpoint)
- MUST use `bun run validate -- --strict` before presenting a plan to ensure semantic quality
- MUST use `bun run update` to modify plans in-place rather than manual JSON editing

## Schema Reference

The JSON schema is defined at `~/.config/opencode/skills/plan-protocol/references/plan-protocol-schema.json`. To display the full schema reference with field descriptions, relationships, constraints, and allowed values at any time, run:

```
bun run read -- --schema
```

### Schema Overview

| Definition | Purpose | Required Fields |
|---|---|---|
| `plan` | Root object with title, description, overview, optional version/created_at/updated_at metadata, and checkpoints array | title, description, overview, checkpoints |
| `checkpoint` | A single implementation step with ID, title, description, dependencies, acceptance criteria, security concerns, and optional blockers | id, title, description, dependencies, acceptance_criteria |
| `acceptance_criterion` | A verifiable condition with ID, description, verification method, optional security concerns, and optional status (pending/passed/failed/blocked) | id, description, verification_method |
| `security_concern` | A security risk with ID, description, severity (enum: critical/high/medium/low), and mitigation | id, description, severity, mitigation |
| `blocker` | A reason a checkpoint is blocked, with optional created_at timestamp and resolved flag | reason |

### ID Naming

| Prefix | Pattern | Example | Uniqueness Scope |
|---|---|---|---|
| CP | `^CP-\d+$` | CP-01, CP-02 | All checkpoints |
| AC | `^AC-\d+-\d+$` | AC-01-01, AC-02-03 | All checkpoints |
| SC | `^SC-\d+(-\d+)?$` | SC-01, SC-01-01 | All checkpoints and ACs |

### Validation Rules

1. Schema conformance (AJV against JSON Schema)
2. ID uniqueness (no duplicate CP, AC, or SC IDs)
3. Dependency integrity (all deps point to existing checkpoints)
4. Dependency ordering (deps appear earlier in the array)
5. No circular dependencies
6. Min 1 AC per checkpoint
7. Verification method required on every AC
8. Strict mode adds: subjective language detection, placeholder detection, minimum length checks

## Example

**User:** "Explain the plan for adding user authentication to our API"

**Output (JSON):**
```json
{
  "plan": {
    "title": "Add User Authentication to API",
    "description": "Implement JWT-based authentication for all API endpoints",
    "overview": "Add user registration, login, token refresh, and middleware to protect routes. Uses bcrypt for password hashing and RS256 JWTs.",
    "checkpoints": [
      {
        "id": "CP-01",
        "title": "User Registration Endpoint",
        "description": "Create POST /api/register with email, password validation and bcrypt hashing",
        "dependencies": [],
        "acceptance_criteria": [
          {
            "id": "AC-01-01",
            "description": "Registration rejects invalid email formats with 400 status",
            "verification_method": "curl POST /api/register with bad email, assert 400",
            "security_concerns": [
              {
                "id": "SC-01-01",
                "description": "Error messages may leak whether email is already registered (user enumeration)",
                "severity": "medium",
                "mitigation": "Return generic 'registration failed' message regardless of failure reason"
              }
            ]
          },
          {
            "id": "AC-01-02",
            "description": "Password is stored as bcrypt hash, not plaintext",
            "verification_method": "Inspect database row; assert hash starts with $2b$"
          }
        ],
        "security_concerns": [
          {
            "id": "SC-01",
            "description": "Registration endpoint is unauthenticated and could be abused for account creation spam",
            "severity": "high",
            "mitigation": "Add rate limiting (5 requests/min per IP) and optional CAPTCHA for production"
          }
        ]
      }
    ]
  }
}
```

**Output (Markdown):**
```markdown
# Plan: Add User Authentication to API

**Description:** Implement JWT-based authentication for all API endpoints

**Overview:** Add user registration, login, token refresh, and middleware to protect routes. Uses bcrypt for password hashing and RS256 JWTs.

---

## Checkpoints

### [CP-01] User Registration Endpoint ⬜ (0/2 ACs, 2 SCs)

**Description:** Create POST /api/register with email, password validation and bcrypt hashing

**Dependencies:** None

**Acceptance Criteria:**
- ⬜ [AC-01-01] Registration rejects invalid email formats with 400 status — *Verify: curl POST /api/register with bad email, assert 400*
- ⬜ [AC-01-02] Password is stored as bcrypt hash, not plaintext — *Verify: Inspect database row; assert hash starts with $2b$*

**Security Concerns:**
- [SC-01] [high] Registration endpoint is unauthenticated and could be abused for account creation spam
  - **Mitigation:** Add rate limiting (5 requests/min per IP) and optional CAPTCHA for production

**Security Concerns (AC-01-01):**
- [SC-01-01] [medium] Error messages may leak whether email is already registered (user enumeration)
  - **Mitigation:** Return generic 'registration failed' message regardless of failure reason

---

## Summary

- **Total Checkpoints:** 1
- **Total Acceptance Criteria:** 2
- **Total Security Concerns:** 2
- **Critical Concerns:** 0
- **High Concerns:** 1
```
