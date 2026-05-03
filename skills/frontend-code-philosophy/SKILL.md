---
name: frontend-code-philosophy
description: Use this skill when planning or implementing frontend code to ensure UI implementation adheres to clean code, clean architecture, SOLID principles, best practices, security, performance, logging (telemetry), skeleton patterns, and ensures rendering methods contain no business logic.
---

# UI Code Philosophy

This skill ensures that all UI development adheres to high standards of quality, maintainability, and performance.

## Relationship to code-philosophy

This skill is a **frontend-specific supplement** to the universal `code-philosophy` skill. All principles from `code-philosophy` (SOLID, Clean Code, Clean Architecture, Best Practices, Security, Performance, Logging & Telemetry) apply equally to frontend code. This skill covers additional concerns unique to UI development.

## Additional Frontend Principles

### 1. Presentation Layer
- **Rendering Logic**: UI rendering methods/functions must be pure. They should only handle the transformation of state/props into a visual representation and must NOT contain business logic.
- **Skeleton Pattern**: Implement skeleton screens (shimmers) to improve perceived performance during data loading states.

### 2. Frontend-Specific Non-Functional Requirements
- **Security**: Prevent XSS, sanitize user inputs, and avoid exposing sensitive data in the frontend.
- **Performance**: Optimize renders (memoization like `React.memo`, `useMemo`, `useCallback`), minimize re-renders, and ensure efficient asset loading (code splitting, lazy loading).
- **Logging & Telemetry**: Implement structured logging and telemetry to track UI errors, user interactions, and performance bottlenecks.

### 3. State Management
- Choose a state management approach appropriate to the application's complexity (local state, Context API, Zustand, Redux, etc.).
- Keep state as close to where it's used as possible (colocation).
- Separate server state (data fetching/caching) from UI state (theming, modals, form inputs).

### 4. Error Handling in the UI
- Implement Error Boundaries (or framework equivalents) to prevent entire UI crashes from isolated component failures.
- Provide meaningful fallback UIs for error states.
- Gracefully degrade functionality when backend services are unavailable.

### 5. Accessibility (a11y)
- Use semantic HTML elements (e.g., `<nav>`, `<main>`, `<button>`) to provide native accessibility.
- Ensure all interactive elements are keyboard navigable.
- Provide ARIA attributes where semantic HTML is insufficient.
- Maintain sufficient color contrast ratios (WCAG AA minimum).
- Support screen readers with descriptive alt text and aria-labels.

## Workflow
When applying the Frontend Code Philosophy skill:
1. **Analyze**: Evaluate the UI code against the principles above and the universal `code-philosophy` principles.
2. **Identify**: Point out violations (e.g., "This component mixes business logic into the render method").
3. **Propose**: Suggest a refactored version following these philosophies.
4. **Explain**: Briefly describe why the new implementation is superior.
