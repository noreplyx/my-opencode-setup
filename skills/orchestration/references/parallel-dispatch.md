# Parallel Dispatch

## Parallelism Verification Protocol

Before every parallel dispatch decision, the Orchestrator MUST run the parallelism check.

### Automatic Parallelism Detection

Before deciding whether to dispatch tasks in parallel, the Orchestrator runs an automated dependency check:

1. **Collect planned files**: From the plan manifest, extract all target files and their checkpoints
2. **Scan for shared dependencies**: For each pair of files, `grep` for cross-references:
   ```
   grep "from '" src/services/user.ts | grep "types"
   # If file A imports from file B → sequential
   # If no cross-imports → candidates for parallelism
   ```
3. **Check for shared state**: Look for shared global state, module-level variables, or singletons
4. **Decision**:
   - No shared deps, no shared state → DISPATCH PARALLEL
   - Shared deps but different files → DISPATCH PARALLEL with merge notes
   - Shared state or same file → DISPATCH SEQUENTIAL

### Automated Script

Use the parallelism detection script to get an automated recommendation. This script reads the manifest, scans files for cross-references using grep/rg, builds a dependency graph using Kahn's algorithm, detects shared state patterns, and outputs a recommendation:

| Recommendation | Meaning |
|---|---|
| **SINGLE_FILE** | Single target — no decision needed |
| **PARALLEL** | No cross-references — safe to dispatch simultaneously |
| **SEQUENTIAL** | Chain dependency detected — must run one phase after another |
| **HYBRID** | Multi-phase with parallel groups within each phase |

---

## Decision Tree (Fallback)

Before dispatching parallel tasks, answer these questions in order:

### 1. Are the sub-tasks truly independent?
- Do they operate on different files? → Yes/No
- Do they have no output dependencies on each other? → Yes/No
- Can they be verified independently? → Yes/No
- If ALL YES → Proceed to question 2. If ANY NO → Dispatch sequentially.

### 2. Will parallel execution cause merge conflicts?
- Will multiple agents write to the same file? → If YES, dispatch sequentially unless using Integrator Phase 1
- Will one agent's output change the API contract another depends on? → If YES, dispatch sequentially

### 3. What's the complexity of each sub-task?
- Simple (< 5 files each) → safe to parallelize
- Complex (> 5 files each) → may benefit from sequential focus

---

## Automated Dispatch Manifest

```bash
ts-node skills/scripts/orchestration/parallel-dispatch.ts --manifest=plan-manifests/<feature>/v<version>-manifest.json --pipeline-id=<id>
```

This creates per-phase dispatch manifests at `.opencode/dispatch/<pipelineId>/phase-<N>.json` with:
- File-level checkpoint breakdown
- Agent instructions
- Phase dependency ordering
- Post-phase actions (`mergeAfter`, `integrateAfter`)

Use `--dry-run` to preview, `--plan` for human-readable output, and `--verify` for consistency checking.

---

## Integrator Merge Verification (Phase 1)

After parallel Implementor dispatch, the Integrator runs a 4-pass merge check:

| Pass | Check | Description |
|---|---|---|
| 1 | Import Path Verification | Every `from '...'` import → target file exists |
| 2 | Type Signature Alignment | Imported function/class names match exported names |
| 3 | Interface Contract Verification | Parameter count consistency between callers and callees |
| 4 | Re-export Completeness | Barrel files re-export everything from parallel-created modules |

### Consistency Score

| Score | Meaning | Action |
|---|---|---|
| 1.0 | No issues | Proceed to Build Gate |
| 0.75 | Non-blocking warnings | Proceed to Build Gate, note in warnings |
| 0.25 | Blocking imports | Report to Orchestrator, cycle back to Implementor/Fixer |
| 0.1 | Blocking types | Report to Orchestrator, cycle back to Implementor/Fixer |
| 0.0 | Both blocking | Report to Orchestrator, cycle back to Implementor/Fixer |

---

## Shared Test Manifest

When QA and Browser Tester run in parallel, use the shared test manifest to coordinate. This prevents the race condition where "QA passed but Browser Tester was never run."

### Commands

```bash
# Generate from plan manifest
ts-node skills/scripts/orchestration/shared-test-manifest.ts --generate --manifest=... --feature=<name> --out=.opencode/test-manifest.yaml

# Check status
ts-node skills/scripts/orchestration/shared-test-manifest.ts --status

# QA marks logic tests complete
ts-node skills/scripts/orchestration/shared-test-manifest.ts --complete --test-type=logic --test-file=tests/unit/... --result=pass

# Browser Tester marks UI tests complete
ts-node skills/scripts/orchestration/shared-test-manifest.ts --complete --test-type=ui --test-file=tests/e2e/... --result=pass

# Wait for all to finish before proceeding to Verifier
ts-node skills/scripts/orchestration/shared-test-manifest.ts --wait --timeout=300000
```

---

## Parallel Dispatch Version Contracts

### Purpose

When dispatching multiple Implementors in parallel, each creates files that may depend on types/interfaces from other files. Version contracts prevent integration issues by ensuring each file declares what versions of dependencies it expects, and the Integrator's Phase 1 verifies they match.

### Version Contract Format

Each file created by a parallel Implementor includes an `@contract` comment at the top:

```typescript
// @contract version 1.0
// @exports: UserService, CreateUserDto, UserResponse
// @depends: types/user.types.ts@^1.0 (User, CreateUserDto)
```

When the Integrator runs (Phase 1), it:
1. Extracts all `@contract` comments from all new files
2. Verifies that each `@depends` entry matches a corresponding `@exports` entry in another file
3. Checks version compatibility (semver range matching)
4. Reports any mismatches

### Contract Format Specification

```typescript
// @contract <semver-version>
// @exports: <comma-separated-export-names>
// @depends: <file-path>@<semver-range> (<comma-separated-symbol-names>)
// @depends: <file-path>@<semver-range> (<comma-separated-symbol-names>)
```

Rules:
- `@contract` is the version of THIS file (what it exports)
- `@depends` lists dependencies on OTHER files with expected version ranges
- Each `@depends` includes the file path, version range (semver), and symbols needed
- Multiple `@depends` lines are allowed
- The contract block MUST be at the top of the file (first 10 lines)

### Integrator Phase 1 Integration

The Integrator Phase 1 checks these contracts:

```yaml
# In Integrator output:
contractVerification:
  totalContracts: 3
  matched: 3
  mismatched: 0
  warnings: []
  details:
    - file: "src/types/user.types.ts"
      version: "1.0"
      exports: ["User", "CreateUserDto", "UserResponse"]
    - file: "src/services/user.service.ts"
      version: "1.0"
      depends:
        - target: "src/types/user.types.ts"
          expectedRange: "^1.0"
          resolved: "1.0"
          status: "matched"
    - file: "src/controllers/user.controller.ts"
      version: "1.0"
      depends:
        - target: "src/services/user.service.ts"
          expectedRange: "^1.0"
          resolved: "1.0"
          status: "matched"
```

### When to Use

| Dispatch Mode | Version Contracts Required? |
|---|---|
| Single Implementor | No (no merge needed) |
| Parallel Implementors (independent files) | ✅ Yes — ensures cross-file type compatibility |
| Parallel Implementors (with Integrator Phase 1) | ✅ Yes — Integrator Phase 1 checks contracts |
| Sequential Implementors | No (files built on each other directly) |

### Hard Rules

- ❌ NEVER dispatch parallel Implementors without @contract annotations in all new files
- ❌ NEVER skip Integrator Phase 1 contract verification when using parallel dispatch
- ✅ ALWAYS include @contract/@exports/@depends in every new file from parallel dispatch
- ✅ ALWAYS use semver ranges (@^1.0, @~1.0, @1.0.0) for dependency versions
- ✅ ALWAYS report contract mismatches as blocking issues (prevent proceeding to Build Gate)

---

## Example: Parallel Dispatch

```markdown
Orchestrator to Implementor (instance 1):
"Create src/types/user.ts with User and CreateUserDto interfaces."

Orchestrator to Implementor (instance 2):
"Create src/services/user.ts with UserService class."

Orchestrator to Implementor (instance 3):
"Create src/controllers/user.ts with UserController class."
```

When all 3 return, check:
- Imports between files reference the correct paths
- Types used in services match types defined in types file
- Controller methods match service method signatures

---

## Integrator Agent Workflow

| Phase | What it does | Mode |
|---|---|---|
| **1: Verify** | Reads files, checks cross-references: imports resolve, type signatures match, interface contracts align | Passive (read-only) |
| **2: Wire** | Writes wiring files: barrel files, DI registrations, route wiring, fix import paths | Active (write) |

### Workflow

```
Parallel Implementor A ──┐
                         ├──► Integrator (Phase 1: verify cross-refs, Phase 2: wire everything) ──► Build Gate
Parallel Implementor B ──┘
```

| Check | Description |
|---|---|
| Import Path Verification | Every `from '...'` import → target file exists |
| Type Signature Alignment | Imported function/class names match exported names |
| Interface Contract Verification | Parameter count consistency between callers and callees |
| Re-export Completeness | Barrel files re-export everything from parallel-created modules |

| Result | Action |
|---|---|
| ✅ All consistent | Proceed to Build Gate |
| ⚠️ Warnings only | Proceed to Build Gate, note in warnings |
| ❌ Blocking issues | Report to Orchestrator, cycle back to Implementor/Fixer |

### When to Use

- **Parallel dispatch** (multiple Implementors): Always run Integrator
- **Single Implementor**: Skip Integrator (no parallel files to wire)
- **Single file change**: Skip Integrator (no wiring needed)