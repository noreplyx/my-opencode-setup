---
name: frontend-code-philosophy
description:  Use this skill when planning or implementing frontend code to ensure UI implementation adheres to clean code, clean architecture, SOLID principles, best practices, security, performance, logging (telemetry), skeleton patterns, and ensures rendering methods contain no business logic.
---

# UI Code Philosophy

This skill ensures that all UI development adheres to high standards of quality, maintainability, and performance.

## Core Principles

### 1. Code Quality & Architecture
- **Clean Code**: Write readable, maintainable, and self-documenting code. Use meaningful naming conventions.
- **Clean Architecture**: Separate concerns by decoupling the UI layer from business logic, data sources, and state management.
- **SOLID Principles**:
    - **Single Responsibility**: Each component or function should have one reason to change.
    - **Open/Closed**: Components should be open for extension but closed for modification.
    - **Liskov Substitution**: Subtypes must be substitutable for their base types.
    - **Interface Segregation**: Don't force components to depend on methods they don't use.
    - **Dependency Inversion**: Depend on abstractions, not concretions.
- **Best Practices**: Follow industry-standard patterns for the specific framework used (e.g., React, Vue, Flutter).

### 2. Presentation Layer
- **Rendering Logic**: UI rendering methods/functions must be pure. They should only handle the transformation of state/props into a visual representation and must NOT contain business logic.
- **Skeleton Pattern**: Implement skeleton screens (shimmers) to improve perceived performance during data loading states.

### 3. Non-Functional Requirements
- **Security**: Prevent XSS, sanitize user inputs, and avoid exposing sensitive data in the frontend.
- **Performance**: Optimize renders (memoization), minimize re-renders, and ensure efficient asset loading.
- **Logging & Telemetry**: Implement structured logging and telemetry to track UI errors, user interactions, and performance bottlenecks.
