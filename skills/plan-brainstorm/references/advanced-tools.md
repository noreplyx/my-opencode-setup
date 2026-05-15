# Advanced Tools: Weighted Decision Matrix, Hybridization & Pivoting

This reference covers three advanced techniques for when the standard brainstorming flow isn't enough. Only load this reference when the user is stuck between options or rejects all presented plans.

---

## Tool 1: Weighted Decision Matrix (When the User Is Stuck)

If the user is torn between plans even after seeing the comparative matrix, offer a weighted decision matrix. This quantifies preferences and reveals which plan actually best aligns with their priorities.

### Template

| Criterion | Weight (1-5) | Plan A Score (1-10) | Plan A Weighted | Plan B Score (1-10) | Plan B Weighted |
|---|---|---|---|---|---|
| Delivery speed | 5 | 9 | 45 | 3 | 15 |
| Maintainability | 4 | 4 | 16 | 8 | 32 |
| Scalability | 3 | 3 | 9 | 9 | 27 |
| Ops simplicity | 4 | 8 | 32 | 5 | 20 |
| Security | 5 | 7 | 35 | 7 | 35 |
| **Total** | | | **137** | | **129** |

### How to Use It

1. Let the user pick the criteria that matter most (use the Strategic Fit dimensions as a starting point: delivery speed, maintainability, scalability, ops simplicity, architecture alignment).
2. Ask the user to assign a weight (1-5) to each criterion reflecting how important it is to them.
3. Fill in scores for each plan using the analysis already done — or let the user adjust scores if they disagree.
4. Calculate weighted totals and highlight the winner.

This is not meant to override intuition — it's a tool to make implicit priorities explicit and start a conversation. If the matrix says Plan B but the user still prefers Plan A, ask why: that gap often reveals an unstated criterion.

---

## Tool 2: Hybridization (When the User Is Unsure Between Plans)

When the user is unsure between plans:

1. **First**, offer the weighted decision matrix (Tool 1 above) to quantify their priorities.
2. **If they prefer a qualitative hybrid**, propose one that combines the best elements from different plans:
   - Label clearly which parts come from which plan (e.g., "Take Plan A's quick delivery timeline and Plan B's robust data model")
   - Explain why the hybrid is better than either pure plan

### Example
> "We could hybridize: take **Plan A's simple in-memory rate limiter** for the MVP (ships in 2 hours), and **Plan B's Redis backend** as a seamless upgrade path when you need to scale horizontally. This way you get the speed of Plan A with the safety net of Plan B's architecture."

---

## Tool 3: Pivoting (When the User Rejects All Plans)

When the user rejects all presented plans:

1. Acknowledge the rejection without pushing the same plans again.
2. Ask what specifically is missing or unacceptable about each plan: "What would you change about these approaches?"
3. Use their feedback to generate a new set of plans or pivot the approach entirely.
4. Explicitly offer to pivot: "Would you like me to start fresh with a different set of options based on your feedback?"

### Key Principle

Never push rejected plans. If the user says none of the options work, believe them and start fresh. The goal is to find the right solution, not to be right about your first set of suggestions.

---

## When to Load This Reference

| Scenario | Action |
|----------|--------|
| User says "I can't decide between these" | Offer the Weighted Decision Matrix first |
| User says "I like parts of both" | Propose a specific hybrid combining best elements |
| User says "None of these work" | Acknowledge, ask for feedback, offer to pivot |
| User is silent or hesitant | Offer the matrix as a tiebreaker |
