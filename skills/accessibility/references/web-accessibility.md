---
name: web-accessibility
description: Web-specific accessibility implementation details (HTML, ARIA, keyboard navigation, color contrast, screen readers, forms, responsive design, and testing) to be loaded alongside the main accessibility skill when working on web UI.
---

# Web Accessibility Reference

> Reference for implementing WCAG 2.1 Level AA compliant web interfaces. Load this when working on web (HTML/CSS/JS) UI components.

## Table of Contents

- [1. Semantic HTML](#1-semantic-html)
- [2. ARIA (Accessible Rich Internet Applications)](#2-aria-accessible-rich-internet-applications)
- [3. Keyboard Navigation](#3-keyboard-navigation)
- [4. Color & Contrast](#4-color--contrast)
- [5. Screen Reader Support](#5-screen-reader-support)
- [6. Forms & Input](#6-forms--input)
- [7. Responsive & Adaptive](#7-responsive--adaptive)
- [8. Testing & Verification](#8-testing--verification)

---

## 1. Semantic HTML

- Use native HTML elements with built-in accessibility (e.g., `<button>`, `<nav>`, `<main>`, `<header>`, `<footer>`, `<article>`, `<section>`).
- Use heading levels (`<h1>`–`<h6>`) in a logical, hierarchical order (never skip levels).
- Use `<label>` elements properly associated with form inputs via `for` attribute or wrapping.
- Use `<table>` only for tabular data, not layout. Include `<caption>`, `<thead>`, `<tbody>`, `<th>` with `scope`.

---

## 2. ARIA (Accessible Rich Internet Applications)

- **First Rule of ARIA**: Don't use ARIA if you can use a native HTML element that provides the semantics and behavior you need.
- Use ARIA roles, states, and properties only when native semantics are insufficient:
  - `role="alert"` for dynamic important messages
  - `aria-label`, `aria-labelledby` for elements without visible labels
  - `aria-describedby` for additional descriptions
  - `aria-expanded`, `aria-controls` for expandable content
  - `aria-live="polite"` / `aria-live="assertive"` for dynamic content updates
- **Never** override native semantics (e.g., don't add `role="button"` to a `<button>`).

---

## 3. Keyboard Navigation

- All interactive elements must be keyboard accessible (Tab, Enter, Space, Arrow keys).
- Maintain a logical tab order matching the visual layout (use `tabindex="0"` or `tabindex="-1"`; avoid positive tabindex values).
- Provide visible focus indicators on all interactive elements (never use `outline: none` without a replacement).
- Implement custom keyboard navigation patterns for complex widgets (e.g., arrow key navigation in menus, tabs, grids).
- Ensure no keyboard traps — users must be able to navigate away from any element using the keyboard.

---

## 4. Color & Contrast

- **Color Contrast Ratio** (WCAG AA):
  - Normal text (<18pt / <14pt bold): Minimum 4.5:1
  - Large text (≥18pt / ≥14pt bold): Minimum 3:1
  - UI components and graphical objects: Minimum 3:1
- **Never** use color as the only means of conveying information (add icons, text labels, or patterns).
- Support **high contrast mode** (`prefers-contrast: high`) and **dark mode** (`prefers-color-scheme: dark`).
- Test with color blindness simulators (protanopia, deuteranopia, tritanopia).

---

## 5. Screen Reader Support

- Provide descriptive **alt text** for all images:
  - Informative images: Describe the content and function.
  - Decorative images: Use `alt=""` (empty) to hide from screen readers.
  - Complex images (charts, graphs): Provide a text summary or data table alternative.
- Use `aria-live` regions for dynamic content updates (loading states, error messages, toasts).
- Announce route changes in single-page applications to screen readers.
- Provide skip navigation links (`<a href="#main-content">Skip to main content</a>`).
- Ensure proper focus management for modals, dialogs, and single-page app transitions.

---

## 6. Forms & Input

- Every input must have an associated label (visible, not placeholder-only).
- Group related inputs with `<fieldset>` and `<legend>`.
- Provide clear error messages that identify which field has an error and how to fix it.
- Use `aria-invalid`, `aria-errormessage` for error states.
- Ensure autocomplete attributes for common fields (`autocomplete="email"`, `autocomplete="address-line1"`, etc.).

---

## 7. Responsive & Adaptive

- Support zoom up to 400% without loss of content or functionality.
- Ensure content reflows in a single column at 320px width (no horizontal scrolling).
- Use relative units (rem, em, %) over fixed units (px) where appropriate.
- Test with screen magnification tools and different viewport sizes.

---

## 8. Testing & Verification

### Automated Testing

- Integrate **aXe**, **Lighthouse Accessibility**, or **WAVE** into CI/CD pipelines.
- Use `eslint-plugin-jsx-a11y` for React projects.

### Manual Testing

- Navigate the entire application using only a keyboard.
- Test with a screen reader (NVDA, VoiceOver, JAWS).
- Test with browser zoom at 200% and 400%.
- Test with high contrast mode enabled.
