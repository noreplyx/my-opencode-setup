---
name: security-workflow
description: |
  ⚠️ DEPRECATED — This skill has been merged into security-scan.

  DO NOT load this skill. Load security-scan instead — it provides ALL content
  from this skill (self-review checklist, auto-detection tables, regression test
  generation, severity classification, anti-pattern fixes) plus tool execution
  (SAST, secrets, dependency scanning, supply chain, SBOM, git history).

  See skills/security-scan/SKILL.md for the unified skill.
  This file is kept for backward compatibility only.
  Section mapping: security-workflow §1→security-scan §B.1, §2→§B.2, §3→§B.3, §5→§B.5, §6→§B.6, §7→§B.7
---

# ⚠️ DEPRECATED — Use security-scan Instead

This skill has been **merged** into the unified security-scan skill.

**Old file:** skills/security-workflow/SKILL.md (this file)
**New file:** skills/security-scan/SKILL.md

## Section Mapping

| Old (security-workflow) | New (security-scan) |
|------------------------|---------------------|
| §1 Self-Review Checklist | §B.1 Self-Review Checklist |
| §2 Auto-Detection Table | §B.2 Auto-Detection Table |
| §3 Regression Test Gen | §B.3 Regression Test Gen |
| §3 Coverage Gate | §B.4 Coverage Gate |
| §5 Severity Classification | §B.5 Severity Classification |
| §6 Anti-Pattern Fixes | §B.6 Anti-Pattern Fixes |
| §7 Report Format | §B.7 Report Format |
| §8 Agent Integration | §B.8 Agent Integration |
| Hard Rules | §C Hard Rules |
| Related Skills | §D Related Skills |

## What to Do

**If you are an agent loading this skill:** Change skill("security-workflow") to skill("security-scan"). Use the new §B section numbers.

**If you are a human reading this:** No action needed — the unified skill is already in place.
