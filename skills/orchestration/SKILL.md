---
name: orchestration
description: Use this skill to orchestrate multiple agents to resolve complex problems and achieve overarching goals.
---

## Core Principles

### 1. Multi-Agent Orchestration
- **Goal Decomposition**: Break high-level goals into specific, actionable tasks suitable for specialized agents.
- **Agent Assignment**: Match tasks to the most appropriate agents (e.g., Finder for research, Planner for roadmaps, Implementor for code).
- **Workflow Sequencing**: Define the order of operations, ensuring agents receive the necessary context and outputs from previous steps.

### 2. Task Management
- **Clear Instruction**: Provide each agent with explicit objectives, constraints, and expected output formats.
- **Output Validation**: Review results from each agent before proceeding to the next stage of the workflow.
- **Inter-Agent Coordination**: Manage the hand-off of data and state between different agents to maintain project consistency.

### 3. Result Validation
- **Cross-Agent Verification**: Use a QA agent to validate that the combined output of multiple agents solves the original complex problem.
- **Iterative Refinement**: Cycle back to previous agents if validation reveals gaps or errors in the implementation.
