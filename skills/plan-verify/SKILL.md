---
name: plan-verify
description: Verifies that implemented code follows the specified plan. Compares planned steps against actual implementation to ensure alignment and identify deviations.
---

## Purpose

The plan-verify skill validates that code implementation matches the original plan. It identifies discrepancies, missing steps, and scope creep to ensure the delivered solution aligns with the intended design.

## When to Use

- After completing implementation to verify plan adherence
- During code review to check alignment with design
- Before marking tasks as complete
- When auditing implementation quality
- To identify scope creep or unplanned changes
- For ensuring consistency across team implementations

## Process

### 1. Plan Analysis

Extract and understand the plan:

**Planned Steps**
- List all planned steps/tasks from the plan
- Identify expected outcomes for each step
- Note any specified requirements or constraints
- Document acceptance criteria

**Expected Deliverables**
- Files to be created/modified
- Features to be implemented
- Tests to be written
- Documentation to update

### 2. Code Analysis

Examine the actual implementation:

**Changes Made**
- Review all modified/created files
- Identify implemented features
- Check test coverage
- Review documentation updates

**Implementation Details**
- How each planned step was addressed
- Any additional changes not in the plan
- Deviations from specified approach
- Workarounds or alternative solutions used

### 3. Comparison & Verification

Compare plan vs. implementation:

**Step-by-Step Verification**
For each planned step:
- ✅ Implemented as planned
- ⚠️ Implemented with modifications
- ❌ Not implemented
- ➕ Additional (not in plan)

**Discrepancy Analysis**
For any deviations:
- What was planned vs. what was done
- Reason for deviation (if known)
- Impact of the deviation
- Whether deviation is acceptable or needs correction

### 4. Report Generation

Create a verification report with:

- Summary of plan adherence
- List of completed steps
- List of missing/incomplete steps
- List of unplanned additions
- Recommendations for addressing gaps

## Output Format

```markdown
# Plan Verification Report

## Summary
- **Plan Adherence**: [High/Medium/Low]
- **Steps Completed**: X of Y
- **Deviations Found**: N

## Planned Steps Status

| Step | Status | Notes |
|------|--------|-------|
| 1. [Step description] | ✅/⚠️/❌ | [Details] |
| 2. [Step description] | ✅/⚠️/❌ | [Details] |

## Completed Items
- [List of properly implemented items]

## Missing/Incomplete Items
- [ ] [Item 1] - [what's missing]
- [ ] [Item 2] - [what's missing]

## Unplanned Additions
- ➕ [Addition 1] - [reason if known]
- ➕ [Addition 2] - [reason if known]

## Deviations

### [Deviation Name]
- **Planned**: [what was planned]
- **Implemented**: [what was done instead]
- **Impact**: [effect of this change]
- **Recommendation**: [accept/revert/fix]

## Recommendations
1. [Action item for missing pieces]
2. [Action item for deviations]
3. [Any follow-up needed]

## Conclusion
[Overall assessment of plan adherence]
```

## Verification Criteria

Check these aspects:

- **Functional Alignment**: Does the code do what the plan specified?
- **Architectural Alignment**: Does the structure match the planned architecture?
- **Completeness**: Are all planned features implemented?
- **No Scope Creep**: Are there unplanned features that should be reviewed?
- **Quality Standards**: Does implementation meet planned quality criteria?
- **Documentation**: Is documentation updated as planned?
- **Testing**: Are tests implemented as specified?

## Status Definitions

| Status | Meaning |
|--------|---------|
| ✅ Complete | Implemented exactly as planned |
| ⚠️ Modified | Implemented with changes from plan |
| ❌ Missing | Not implemented |
| ➕ Added | Implemented but not in original plan |

## Notes

- Distinguish between acceptable adaptations and problematic deviations
- Consider why deviations occurred (unclear plan, technical obstacles, improved approach)
- Flag deviations that affect system behavior or requirements
- Be constructive - the goal is alignment, not blame
- Document lessons learned for future planning
