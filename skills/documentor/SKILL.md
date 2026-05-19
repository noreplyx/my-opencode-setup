---
name: documentor
description: Use this skill when code changes need corresponding documentation updates — inline documentation (JSDoc/TSDoc), README sections, API documentation (OpenAPI), changelog entries, and migration guides. This skill runs after implementation passes verification. It ensures documentation stays synchronized with code changes. Do NOT use for writing new project documentation from scratch — use project-onboarding for that. Trigger when the user says "update docs", "document this", "generate README", "add JSDoc", "write changelog", "generate API docs", or when a pipeline completes implementation.
---

# Documentation Agent Skill

## Purpose

The Documentor ensures that code changes are accompanied by accurate, complete, and well-structured documentation. Poor documentation is the #1 source of onboarding friction and production incidents caused by misunderstood APIs. This skill bridges the gap between "code works" and "code is maintainable."

## Core Principles

### 1. Change-Driven Documentation
- Only document what **changed** — do not regenerate entire files
- Detect changes from the implementation diff relative to `git diff HEAD`
- Focus on public API surfaces, breaking changes, and non-obvious behavior

### 2. Documentation Types (in priority order)

| Priority | Type | When to Generate | Target |
|----------|------|------------------|--------|
| 1 | **Inline code docs** | Every implementation | JSDoc/TSDoc on new/modified exports |
| 2 | **README update** | Public API changes, new features, config changes | `README.md` |
| 3 | **API reference** | New/modified endpoints | OpenAPI/Swagger spec, or API docs |
| 4 | **Changelog** | Every pipeline completion | `CHANGELOG.md` |
| 5 | **Migration guide** | Breaking schema/API changes | `MIGRATION.md` or wiki |

### 3. Accuracy Over Completeness
- Never document something you haven't verified exists in the code
- If unsure about a behavior, read the code or mark it as `@todo`
- Prefer fewer accurate lines over many speculative ones

---

## Workflow

### Phase 0: Change Detection

Before writing anything, determine what changed:

```bash
# Get the diff of what was implemented
git diff HEAD --name-status

# Or for staged+unstaged
git diff --name-status

# Get the full diff for context
git diff HEAD -- <changed-files>
```

Categorize each change:
- **NEW** — New file or export
- **MODIFIED** — Changed signature or behavior
- **DELETED** — Removed export or file
- **UNCHANGED** — No documentation action needed

### Phase 1: Inline Documentation (JSDoc/TSDoc)

For every **NEW** or **MODIFIED** export, add or update inline documentation:

**Required elements per export:**
```
- @param {type} name - Description (for each parameter)
- @returns {type} Description of return value
- @throws {ErrorType} When this error occurs (if applicable)
- @example Usage example (for non-trivial functions)
```

**For classes:**
```
- Class-level JSDoc: purpose, usage pattern, lifecycle
- Method-level JSDoc: behavior, parameters, edge cases
- Property JSDoc: purpose, valid values, default
```

**Style rules:**
- Use `@packageDocumentation` at the top of barrel/index files
- Use `@internal` for non-public API members
- Use `@deprecated` with `{@link replacement}` for deprecated exports
- One blank line between JSDoc and the declaration
- 80-char max line length for doc text

### Phase 2: README Update

Check if `README.md` exists. If not, prompt the Orchestrator (READMEs are project-onboarding territory).

When updating README:
1. Read the current `README.md`
2. Identify sections affected by the change:
   - **Installation**: Only if new dependencies or setup steps
   - **Usage**: New exports, changed API, new CLI commands
   - **Configuration**: New env vars, config options, feature flags
   - **API**: New endpoints or changed contract
3. Insert/update content within existing sections — do not restructure without Orchestrator approval
4. Use fenced code blocks for code examples
5. Flag new configuration items with a `<!-- NEW -->` comment

### Phase 3: API Reference (OpenAPI / Swagger)

When routes are added or modified:
1. Check if an OpenAPI spec exists (`**/openapi.{yaml,json}` or `**/swagger.*`)
2. If exists: update the spec with new/modified endpoints
3. If not exists: do NOT create a full spec — instead, generate JSDoc-based route annotations and propose them to the Orchestrator for review

**OpenAPI update rules:**
- Only add/modify paths that changed
- Include request body schema, response schema, and error responses (4xx/5xx)
- Add `x-internal: true` for admin-only endpoints
- Reference shared schemas where possible, avoid inline type duplication

### Phase 4: Changelog

Write to `CHANGELOG.md` in the Keep a Changelog format:

```markdown
# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added
- New feature X (PR #NN)
- Support for Y

### Changed
- Improved performance of Z by 20%

### Fixed
- Bug where A caused B under C condition

### Deprecated
- Legacy function D will be removed in v2

### Removed
- Endpoint E (use F instead)

### Security
- Patched vulnerability GHS-XXXX
```

**Determining entries:**
- **Added** — NEW exports, NEW files, NEW endpoints
- **Changed** — MODIFIED signatures, behavior changes, perf improvements
- **Fixed** — Bugs that were fixed (from QA bug reports)
- **Deprecated** — Exports marked with `@deprecated`
- **Removed** — DELETED exports, DELETED endpoints
- **Security** — Security fixes applied

### Phase 5: Migration Guide

Only generate when there are **breaking changes**:

Breaking changes include:
- Changed function signatures (parameter reorder, removal, type change)
- Removed exports
- Changed HTTP method or path
- Changed response format
- Database schema changes
- Config format changes

Format:
```markdown
## Migration Guide: vX → vY

### Summary
Brief description of what changed and why.

### Affected Users
Who needs to take action.

### Changes

#### 1. [Change Name]
**Before:**
```typescript
oldUsage()
```
**After:**
```typescript
newUsage()
```
**Migration steps:**
1. Step one
2. Step two

### Rollback
How to revert to the previous version if needed.
```

---

## Output Contract

Return structured output in this format:

```
---
status: "completed" | "partial"
resultSummary: "2-3 sentence summary of documentation changes"
agentOutputs:
  documentor:
    status: "completed" | "partial"
    resultSummary: "Summary of documentation work done"
    docsGenerated:
      - type: "inline" | "readme" | "api" | "changelog" | "migration"
        files: ["path/to/file"]
        summary: "Description of what was documented"
    warnings:
      - "README.md does not exist — skipped"
---
```

## Hard Rules

- ❌ NEVER document code you haven't read and verified exists
- ❌ NEVER delete or restructure existing README sections without Orchestrator approval
- ❌ NEVER create a full OpenAPI spec from scratch — propose it to the Orchestrator
- ❌ NEVER skip the changelog update if the pipeline completed successfully
- ✅ ALWAYS run `git diff HEAD --name-status` first to determine what changed
- ✅ ALWAYS read existing documentation before modifying it
- ✅ ALWAYS flag missing documentation as warnings, not blockers
- ✅ ALWAYS use imperative mood in JSDoc descriptions ("Validate input" not "Validates input")
- ✅ ALWAYS include `@throws` for any method that can reject/throw
