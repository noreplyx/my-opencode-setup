---
name: frontend-code-philosophy
description: Use this skill when planning or implementing frontend code to ensure UI implementation adheres to clean code, clean architecture, SOLID principles, best practices, security, performance, logging (telemetry), skeleton patterns, and ensures rendering methods contain no business logic.
---

# Frontend Code Philosophy

This skill provides frontend-specific guidelines that supplement the universal `code-philosophy` skill. It covers web-standard UI development using vanilla JavaScript, HTML, and CSS — applicable regardless of framework choice.

## Relationship to code-philosophy

This skill is a **frontend-specific supplement** to the universal `code-philosophy` skill. All principles from `code-philosophy` (SOLID, Clean Code, Architecture, Security, Performance, Logging) apply equally to frontend code. This skill covers additional concerns unique to UI development.

When both skills apply, this skill's guidance takes precedence for frontend-specific patterns.

## References

Detailed content is organized into reference files for progressive loading:

| File | Content |
|------|---------|
| `references/component-patterns.md` | Presentation layer, component design, styling, state management, forms |
| `references/ux-and-testing.md` | Security, performance, routing, error handling, testing, logging |

## Core Principles (Summary)

### 1. Presentation Layer
- **Rendering must be PURE** — No business logic in render functions or templates. Extract logic to separate modules, services, or controller layers.
  - **Why**: Pure rendering is predictable (same input → same output), easier to unit test, avoids side-effect bugs during DOM reconciliation, and keeps the UI layer a thin projection of state.
- **Skeleton/Shimmer screens** for loading states — never blank or janky spinners.

### 2. Component Design
- **Container/Presentational** — Separate data-fetching/state orchestration from rendering
- **Composition over inheritance** — Compose small, focused components together
- **Single-file component organization** — Colocate template, logic, and styles per component

### 3. Styling
- CSS Modules for large apps, Tailwind for rapid prototyping, CSS-in-JS for dynamic themes
- BEM naming for maintainable CSS architecture

### 4. State Management
- Start with local/component state, lift only when needed
- Server state → dedicated data-fetching layer with caching
- Shared UI state → events, reactive stores, or DI patterns
- URL state → URL search params and hash as source of truth for filters/sort/pagination

### 5. Forms
- Prefer controlled inputs (state-driven values) — input values owned by the component
- Validate with schema-based validators (e.g. Zod, Yup, Valibot)
- Accessible error messages with `role="alert"`

### 6. Security
- **NEVER use `innerHTML` / `insertAdjacentHTML` / comparable raw-HTML APIs with unsanitized input** — always sanitize with DOMPurify
- Sanitize user input at the boundary
- Secrets must live on the server (BFF pattern)

### 7. Performance
- Memoization to avoid redundant computation
- Code splitting with dynamic imports (`import()`) + loading states
- Virtualization (window-based rendering) for long lists

### 8. Routing
- Prefer flat route structures
- Route-level code splitting via dynamic imports
- URL search params as source of truth for filters/sort/pagination

### 9. Error Handling
- Error boundary per major section (cascading catch handlers, not one for the whole app)
- Graceful degradation: loading → error → empty → success states

### 10. Accessibility
> See the dedicated `accessibility` skill for comprehensive guidance.

### 11. Testing
- Component tests from user's perspective (querying the rendered DOM)
- E2E tests for critical flows (Playwright, Cypress)
- Automated a11y checks (axe-core)

### 12. Logging
- Structured logging with component/action/metadata context
- Web Vitals reporting (CLS, FID, LCP, INP)
- Render tracking in development only

## Workflow

When applying the Frontend Code Philosophy skill:

1. **Analyze the context** — Identify which area of frontend code is being worked on
2. **Reference the relevant section** — Each reference file provides concrete patterns and code examples. For accessibility guidance, load and follow the `accessibility` skill alongside this one.
3. **Evaluate against principles** — Use the checklist below
4. **Propose improvements** — Provide code diffs following the patterns in this skill
5. **Verify** — Build, lint, test, and audit for a11y/performance

### Evaluation Checklist
- ✅ **Rendering purity** — No business logic in render
- ✅ **Component design** — Correct pattern for the use case
- ✅ **State management** — Correctly scoped (local vs shared vs server)
- ✅ **Accessibility** — Semantic HTML, keyboard-nav, ARIA (see `accessibility` skill)
- ✅ **Performance** — Memoization, code splitting, virtualization
- ✅ **Security** — Input sanitized, no XSS, no secrets exposed
- ✅ **Error handling** — Error boundaries, graceful degradation
- ✅ **Forms** — Validation, accessible error messages
- ✅ **Tests** — Component + E2E covering critical flows

## Tooling

This skill ships with an automated check script:

| Script | Purpose | Usage |
|--------|---------|-------|
| `check-frontend.ts` | Detects business logic in render, XSS risks, missing a11y, missing error boundaries, large components | `ts-node skills/scripts/frontend-philosophy/check-frontend.ts --dir=<project-dir>` |

```bash
# Run after component implementation
ts-node skills/scripts/frontend-philosophy/check-frontend.ts --dir=./
```

> **For detailed patterns and code examples**, see the reference files:
> - `references/component-patterns.md` — Component design, state management, forms
> - `references/ux-and-testing.md` — Security, performance, routing, testing, logging
