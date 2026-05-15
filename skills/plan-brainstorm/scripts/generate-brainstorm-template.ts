#!/usr/bin/env ts-node
/**
 * Brainstorm Template Generator
 * 
 * Generates a structured markdown template for brainstorming sessions.
 * Saves the agent from reconstructing table formats from scratch.
 * 
 * Usage: ts-node generate-brainstorm-template.ts --name=<feature-name> [--plans=2|3]
 * 
 * Output: Writes a markdown template to stdout
 */

interface TemplateOptions {
  featureName: string;
  planCount: 2 | 3;
}

function parseArgs(): TemplateOptions {
  const name = process.argv.find(a => a.startsWith('--name='))?.split('=')[1];
  const plans = process.argv.find(a => a.startsWith('--plans='))?.split('=')[1];
  
  if (!name) {
    console.error('Usage: ts-node generate-brainstorm-template.ts --name=<feature-name> [--plans=2|3]');
    process.exit(1);
  }
  
  return {
    featureName: name,
    planCount: (plans === '3' ? 3 : 2) as 2 | 3,
  };
}

function generatePlanSection(planLabel: string, planIndex: number): string {
  const letter = String.fromCharCode(65 + planIndex); // A, B, C
  return `
### Plan ${letter}: {{${planLabel}}}

**Goal:** {{Clear, concise statement of what this specific plan aims to achieve}}

**Summary:** {{High-level overview of the proposed implementation logic and architecture}}

<!-- Insert mermaid diagram here if plans differ at architecture/component level -->

**Steps:**
1. {{Step 1}}
2. {{Step 2}}
3. {{Step 3}}

**Pros:**
| # | Pro | Impact | Evidence / Reasoning |
|---|---|---|---|
| 1 | {{Title}} | High/Med/Low | {{Why this matters, backed by data or experience}} |
| 2 | {{Title}} | High/Med/Low | {{...}} |
| 3 | {{Title}} | High/Med/Low | {{...}} |
| 4 | {{Title}} | High/Med/Low | {{...}} |
| 5 | {{Title}} | High/Med/Low | {{...}} |

**Cons:**
| # | Con | Severity | Mitigation / Acceptance |
|---|---|---|---|
| 1 | {{Title}} | High/Med/Low | {{Can we mitigate it, or must we accept it?}} |
| 2 | {{Title}} | High/Med/Low | {{...}} |
| 3 | {{Title}} | High/Med/Low | {{...}} |
| 4 | {{Title}} | High/Med/Low | {{...}} |
| 5 | {{Title}} | High/Med/Low | {{...}} |

**Concerns:**
- 🔴 **Scalability:** {{Concern}}
- 🟡 **Reliability:** {{Concern}}
- 🟠 **Security:** {{Concern}}
- ⚪ **Operability/Cost/Tech Debt/Observability:** {{Concern}}

**Strategic Fit:**
| Dimension | Rating (1-10) | Rationale |
|---|---|---|
| Speed of delivery | /10 | {{How fast can this ship?}} |
| Long-term maintainability | /10 | {{How expensive is it to change in 6 months?}} |
| Scalability ceiling | /10 | {{At what traffic/scale does this break?}} |
| Operational complexity | /10 | {{How many moving parts?}} |
| Architecture alignment | /10 | {{Does it fit or fight the current system?}} |

**Risk Profile:**
| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| {{Single point of failure}} | High/Med/Low | High/Med/Low | {{Mitigation strategy}} |
| {{Third-party dependency}} | High/Med/Low | High/Med/Low | {{Fallback / circuit breaker}} |
| {{Data loss scenario}} | High/Med/Low | High/Med/Low | {{Backup / replay strategy}} |
| {{Migration complexity}} | High/Med/Low | High/Med/Low | {{Rollback plan}} |

**Verification Strategy:**
- **Test cases:** {{Specific scenarios to validate, including edge cases}}
- **Success metrics:** {{e.g., "p95 latency < 200ms"}}
- **Rollback trigger:** {{Condition that would cause a rollback}}
- **Rollback execution:** {{Steps to revert}}
`;
}

function generateComparativeMatrix(planCount: number): string {
  const plans = [];
  for (let i = 0; i < planCount; i++) {
    const letter = String.fromCharCode(65 + i);
    plans.push(`Plan ${letter}: {{Name}}`);
  }
  
  const headers = `| Criterion | ${plans.join(' | ')} |`;
  const separator = `|---|---${'---|'.repeat(planCount)}`;
  
  return `
### Comparative Matrix

${headers}
${separator}
| Time to ship | {{}} | {{}} |
| Cost at small scale | {{}} | {{}} |
| Cost at large scale | {{}} | {{}} |
| Ops burden | {{}} | {{}} |
| Failure recovery | {{}} | {{}} |
| Testability | {{}} | {{}} |
| Rollback complexity | {{}} | {{}} |

**Recommended Scenario for each plan:**
- **Plan A:** {{When this plan is the best choice}}
- **Plan B:** {{When this plan is the best choice}}
`;
}

function generateHardRulesChecklist(): string {
  return `
### ✅ Brainstorming Quality Checklist

- [ ] Asked at least 3 deep probing questions before presenting plans
- [ ] Presented at least 2 distinct approaches
- [ ] Each plan has 5+ pros with impact ratings
- [ ] Each plan has 5+ cons with severity ratings
- [ ] Each plan surfaces 3+ concerns across different categories
- [ ] Side-by-side comparative matrix included
- [ ] Strategic fit analysis included (1-10 ratings)
- [ ] Risk profile assessment included
- [ ] Verification strategy included (tests, metrics, rollback trigger + steps)
- [ ] Session ends by asking user to choose, hybridize, or pivot
`;
}

function generateTemplate(options: TemplateOptions): string {
  const { featureName, planCount } = options;
  
  let template = `# Brainstorm Session: ${featureName}

## Questions

<!-- Ask 3-5 probing questions first: Clarifying, Constraint, Risk, Stakeholder -->

1. {{Clarifying question about requirements/scale/scope}}
2. {{Constraint question about budget/team/expertise/compliance}}
3. {{Risk probe about failure modes/dependencies}}
4. {{Stakeholder question about timeline/consumers/prior attempts}}

---

## Plans

`;

  for (let i = 0; i < planCount; i++) {
    const labels = ['Quick Win', 'Scalable / Robust', 'Event-Driven / Advanced'];
    template += generatePlanSection(labels[i], i);
    template += '\n---\n';
  }

  template += generateComparativeMatrix(planCount);
  template += '\n---\n';
  template += `
## Decision

**Which direction should we go?**
- Choose one of the plans above
- Hybridize — combine the best parts of multiple plans
- Pivot — I can generate entirely new approaches based on your feedback
`;
  template += generateHardRulesChecklist();

  return template;
}

function main(): void {
  const options = parseArgs();
  const template = generateTemplate(options);
  console.log(template);
}

main();
