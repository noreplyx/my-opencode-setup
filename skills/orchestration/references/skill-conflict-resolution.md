---
name: skill-conflict-resolution
description: Reference document defining priority-based conflict resolution rules when multiple AI agent skills are loaded simultaneously with conflicting guidance.
---

# Skill Loading Conflict Resolution

*This content was extracted from `skills/orchestration/SKILL.md` to reduce file size and avoid duplication. The Orchestrator can load this reference when skill conflicts arise.*

### The Problem
Multiple skills may be loaded simultaneously (e.g., `code-philosophy` + `accessibility` for a UI component). Their instructions may conflict. For example, one skill says "use named exports" while another shows default export examples.

### Priority Table
When multiple skills are loaded and provide conflicting guidance, use this priority order (highest wins):

| Priority | Skill | Domain | When It Overrides |
|----------|-------|--------|-------------------|
| 1 (Highest) | `accessibility` | Accessibility | UI components, forms, interactive elements |
| 2 | `security-scan` | Security | Auth, input handling, data access |
| 3 | `backend-code-philosophy` | Backend | Server-side code |
| 4 | `frontend-code-philosophy` | Frontend | Client-side code |
| 5 | `plan-describe` | Roadmapping | Planning phases |
| 6 | `plan-verification` | Verification | Verification methodology |
| 7 | `qa-workflow` | Testing | Test design and execution |
| 8 (Lowest) | `code-philosophy` | General | General guidance -- yields to all above |

### Conflict Resolution Rules
1. **Specific overrides general**: `accessibility` overrides `code-philosophy` on UI patterns
2. **Domain-specific overrides cross-cutting**: `backend-code-philosophy` overrides `code-philosophy` on backend patterns
3. **Safety-critical overrides convenience**: security-scan + semgrep-scan + gitleaks-scan + trivy-scan override code-philosophy on input handling, SAST patterns, secret detection, and vulnerability/misconfig scanning
4. **When equal priority**: Use the skill loaded most recently
5. **When truly contradictory**: Flag to Orchestrator and ask the user

### Skill Load Logging
Record all loaded skills and their active sections in `agent-context.md`:

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