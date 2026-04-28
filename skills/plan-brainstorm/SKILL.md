---
name: plan-brainstorm
description: Use this skill to help planning and brainstorm technical implementations by exploring multiple architectural and strategic paths. It focuses on collaborative brainstorming to reach the best technical decision.
---

## Guidelines

### 1. Collaborative Brainstorming & Information gathering
- **Brainstorm with User:** Engage the user in a dialogue to explore ideas. Don't just present a final answer; discuss the "why" and "how" together.
- **Information Gathering:** Before finalizing plans, proactively ask the user if more information is needed. Identify gaps in requirements, constraints, performance targets, or existing dependencies to ensure plans are grounded in reality.
- **Gap Warnings:** Explicitly warn the user if critical information, edge cases, or requirements are missing from the current plan. Do not proceed with detailed implementation if a known missing piece of information could fundamentally change the architectural decision.

### 2. Multiple Strategies
Always provide at least two distinct plans (more if possible), offering different approaches (e.g., a "quick-win" vs. a "scalable/robust" approach) to give the user legitimate choices.

### 3. Deep Trade-off Analysis
For every plan, provide a detailed analysis of trade-offs:
- **Pros:** Clearly state the benefits, efficiency gains, or risks mitigated.
- **Cons:** Be honest about technical debt, complexity, potential bottlenecks, or resource costs.
- **Comparison:** Explain why one plan might be preferred over another in specific scenarios.

### 4. Plan Structure
Each proposed plan must include:
- **Goal:** A clear, concise statement of what this specific plan aims to achieve and the primary problem it solves.
- **Summary:** A high-level overview of the proposed implementation logic and architecture.
- **Steps:** A high-level breakdown of technical execution. Keep this concise; avoid excessive detail as the focus is on the strategic approach.

### 5. Verification Strategy
Provide a concrete method to verify that the plan is working as intended:
- Specific test cases or scenarios to validate.
- Success metrics (e.g., "latency should be <<  200ms").
- Verification steps (e.g., "Run test script and check for X output").
