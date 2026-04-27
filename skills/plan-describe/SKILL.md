---
name: plan-describe
description: Use this skill to transform a high-level technical plan or a set of brainstorming ideas into a detailed, actionable implementation roadmap. It focuses on bridging the gap between "what" needs to be done and "how" it will be executed.
---

## Goal
The primary objective is to provide a comprehensive, step-by-step breakdown of a technical plan, ensuring that every architectural decision is analyzed, every dependency is identified, and every implementation detail is explicit.

## Workflow

### 1. Plan Analysis
Break down the high-level plan to identify potential gaps, risks, and assumptions.
- **Decomposition:** Split the plan into logical modules or milestones.
- **Critical Path Analysis:** Identify the sequence of tasks that determines the project duration.
- **Risk Assessment:** Pinpoint potential technical bottlenecks, breaking changes, or security vulnerabilities.
- **Consistency Check:** Ensure the plan aligns with existing project conventions and architectural patterns.

### 2. Implementation Deep Dive
For each module identified in the analysis, provide a deep dive into the "how".
- **Interface Definition:** Specify exactly which functions, classes, or API endpoints need to be created or modified.
- **Data Flow Mapping:** Describe how data moves through the system for each step.
- **Library/Tool Selection:** Justify the choice of specific libraries or utilities based on the codebase.
- **Edge Case Handling:** Explicitly define how the implementation should handle errors, timeouts, and unexpected inputs.
- **Performance Considerations:** Detail how the implementation will maintain or improve system performance.

### 3. Step-by-Step Execution Roadmap
Convert the deep dive into a linear sequence of actionable tasks.
- **Phase 1: Prerequisites & Foundation**
  - List necessary configuration changes, dependency installations, or boilerplate code.
- **Phase 2: Core Implementation**
  - Provide an ordered list of files to edit/create.
  - For each file, specify the exact logic to be implemented (e.g., "Add `validateInput` method to `UserService` to handle X and Y").
- **Phase 3: Integration & Wiring**
  - Describe how the new components are connected to the rest of the system.
  - Detail the sequence of wiring (e.g., "Register the new service in `app.module.ts` after implementing the service logic").
- **Phase 4: Verification & Quality Assurance**
  - Define the specific test cases (unit, integration, E2E) that must pass.
  - Specify the exact commands to run for linting and type-checking.

## Output Requirements
The final description must be so detailed that an implementor can follow it without needing further clarification. It should include:
- A clear "Definition of Done" for each step.
- References to existing files/lines that will be impacted.
- A logical ordering that minimizes rework.
