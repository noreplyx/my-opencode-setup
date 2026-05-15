---
name: accessibility
description: Use this skill when planning or implementing UI code (web or Flutter mobile) to ensure applications are accessible to all users, including those with disabilities, following WCAG standards, platform-specific best practices, and accessibility testing guidelines.
---

# Accessibility (a11y) Philosophy

This skill ensures that all user interfaces — **web (HTML/CSS/JS) and Flutter mobile (Android/iOS)** — are designed and implemented to be usable by people with diverse abilities, following the Web Content Accessibility Guidelines (WCAG) and established accessibility best practices for each platform.

> **Common Principles**: WCAG's POUR principles (Perceivable, Operable, Understandable, Robust) apply equally to both web and mobile applications. For platform-specific details, load the appropriate reference file(s) below.

---

## Platform Selection Matrix

Load the reference files that match your current task:

| You are... | Load this reference |
|------------|-------------------|
| Building a **web** UI (HTML/CSS/JS/React) | `references/web-accessibility.md` |
| Building a **Flutter** app (Android/iOS) | `references/flutter-accessibility.md` |
| Setting up **testing** infrastructure | `references/testing-tools.md` |
| Working on **both** web and Flutter | Load all three |

---

## WCAG Compliance Levels

Strive for at minimum **WCAG 2.1 Level AA** compliance (applies to both web and mobile):

| Principle | Guideline | Web Examples | Flutter Examples |
|-----------|-----------|--------------|------------------|
| **Perceivable** | Information must be presentable to users in ways they can perceive | Alt text, captions, adaptable layouts | `Semantics` labels, `excludeSemantics`, media captions |
| **Operable** | UI components must be operable by all users | Keyboard navigation, sufficient time, no seizures | TalkBack/VoiceOver gestures, focus traversal, timer controls |
| **Understandable** | Information and UI must be understandable | Readable text, predictable behavior, input assistance | `MediaQuery.textScaleFactor`, predictable navigation, input helpers |
| **Robust** | Content must be interpretable by assistive technologies | Semantic HTML, ARIA compatibility | Flutter's built-in Semantics tree, platform channels |

---

## ARIA-to-Flutter Property Mapping

| ARIA Property | Flutter Equivalent |
|---------------|-------------------|
| `aria-label` | `Semantics(label: ...)` |
| `aria-describedby` | `Semantics(hint: ...)` |
| `aria-expanded` | `Semantics(expanded: ...)` |
| `aria-hidden` | `excludeSemantics` or `Semantics(explicitChildNodes: true)` |
| `aria-live="polite"` | `Semantics(liveRegion: true)` |
| `aria-live="assertive"` | `Semantics(liveRegion: true, assertiveness: ...)` |
| `role="button"` | `Semantics(button: true)` |
| `role="link"` | `Semantics(link: true)` |
| `role="slider"` | `Slider` widget (built-in semantics) |
| `role="alert"` | `Semantics(liveRegion: true)` on snackbar/toast |
| `aria-disabled` | `Semantics(enabled: false)` |
| `aria-checked` | `Semantics(checked: true/false)` for checkboxes |
| `aria-selected` | `Semantics(selected: true/false)` for tabs/items |
| `aria-invalid` | Custom via `Semantics(label: 'Error: ...')` + visual styling |
| `tabindex` | `FocusTraversalGroup` + `Focus` nodes |

---

## Workflow

When applying the Accessibility skill:

1. **Audit**: Review the UI against WCAG 2.1 AA criteria and the principles above.
   - **Web**: Use browser DevTools, Lighthouse, aXe, or WAVE.
   - **Flutter**: Use Flutter Inspector (Semantics view), `Accessibility Scanner` (Android), Xcode Accessibility Inspector (iOS), or `flutter_test` a11y matchers.
2. **Identify**: Document specific violations with:
   - The affected component/widget/element
   - The WCAG criterion violated (e.g., "1.1.1 Non-text Content", "2.4.3 Focus Order")
   - Platform (Web / Flutter Android / Flutter iOS)
   - Severity (Critical / High / Medium / Low)
3. **Propose**: Suggest fixes following accessibility best practices for the relevant platform. Load the appropriate reference file for detailed guidance.
4. **Verify**: Re-run automated tests and perform manual testing with assistive technology (TalkBack, VoiceOver, NVDA, etc.) to confirm the fix. Load `references/testing-tools.md` for the testing matrix.

---

## Core Principles Summary

- **Semantic structure**: Use native HTML elements (web) or Semantics widgets (Flutter). Never skip heading levels.
- **Labels everywhere**: Every interactive element needs an accessible label — alt text for images, aria-label or Semantics(label) for controls.
- **Never rely on color alone**: Always pair color coding with icons, text labels, or patterns.
- **Keyboard/gesture operable**: All interactive elements must be reachable via keyboard (web) or focus traversal (Flutter). No gesture traps.
- **Sufficient contrast**: 4.5:1 minimum for normal text, 3:1 for large text and UI components.
- **Dynamic content announcements**: Use `aria-live` (web) or `Semantics(liveRegion: true)` (Flutter) for toasts, errors, and loading states.
- **Focus management**: Never remove focus outlines without a visible alternative. Trap focus in modals/dialogs.
- **Respect user settings**: Support zoom (web), `prefers-reduced-motion`, `prefers-contrast`, dark mode (web), and `MediaQuery` system settings (Flutter).

---

## Flutter-Specific Implementation Checklist

Use this checklist when implementing or auditing a Flutter app:

- [ ] **Semantics tree is complete**: Every interactive element has a `Semantics` label. Use `Flutter Inspector` → "Enable Semantics" to view the tree.
- [ ] **No `excludeSemantics` on interactive elements** — only on decorative/visual-only elements.
- [ ] **Custom `CustomPainter`/`Canvas` widgets** are wrapped in `Semantics` with proper labels.
- [ ] **`SemanticsDelegate`**: For complex custom widgets, implement `SemanticsDelegate` to provide precise semantics.
- [ ] **`MergeSemantics`**: Group logical units (e.g., card with title + subtitle + icon) into one focusable node.
- [ ] **Focus order is logical**: Keyboard/d-pad navigation follows visual reading order.
- [ ] **Touch targets ≥ 48dp** (Material tap target size).
- [ ] **Text scales correctly**: All text uses `TextTheme` styles, not hardcoded sizes.
- [ ] **Errors are announced**: Validation errors use `liveRegion: true`.
- [ ] **Loading states announced**: Activity indicators have `Semantics(label: 'Loading...', liveRegion: true)`.
- [ ] **Modal dialogs trap focus**: Use native `showDialog` or `showModalBottomSheet` (they handle this automatically).
- [ ] **Page transitions announced**: `Semantics(route: true, label: 'Page title')` on route change.
- [ ] **No color-only information**: Icons, text, or patterns supplement color.
- [ ] **Contrast ratios pass**: At minimum 4.5:1 for normal text, 3:1 for large text and UI components.
- [ ] **Respects system settings**: `textScaleFactor`, `boldText`, `highContrast`, `disableAnimations`, `accessibleNavigation`.
- [ ] **Custom gestures have alternatives**: Swipe-to-delete also available via button; drag-to-reorder via menu, etc.
- [ ] **Platform channels respect a11y**: Any native platform views embedded via `AndroidView`/`UiKitView` must have proper `Semantics` integration.
- [ ] **`flutter_test` a11y matchers pass**: `androidTapTargetGuideline`, `iOSTapTargetGuideline`, `labeledTapTargetGuideline`, `ensureSemanticLabels`, `contrastGuideline`.

---

## Tooling (Automated Static Analysis)

This skill includes an executable script that performs static analysis of React/HTML/Vue components for accessibility violations.

### Available Scripts

| Script | Purpose | Usage |
|--------|---------|-------|
| `check-a11y.ts` | Static analysis for WCAG violations: missing alt, missing labels, non-semantic HTML, focus outlines, color-only info, missing live regions | `ts-node <skills-dir>/scripts/accessibility/check-a11y.ts --dir=<project-dir> [--verbose]` |

### WCAG Violations Detected

| WCAG | Issue | Severity |
|------|-------|----------|
| 1.1.1 | Images missing alt attribute | Critical |
| 1.3.1 | Form inputs without accessible labels | High |
| 2.1.1 / 4.1.2 | Non-semantic elements (div/span) used as clickable elements | High |
| 3.1.1 | Missing lang attribute on `<html>` | High |
| 2.4.7 | Focus outline removed without replacement | High |
| 1.4.1 | Color used as only means of conveying information | Medium |
| 4.1.3 | Dynamic content without aria-live region | Medium |

### CI Integration

The script exits with code 1 if any critical or high-severity issues are found.

```bash
# Run the a11y checker after UI development
ts-node skills/scripts/accessibility/check-a11y.ts --dir=./
ts-node skills/scripts/accessibility/check-a11y.ts --dir=./ --verbose
```

For platform-specific testing guidance and the assistive technology testing matrix, load `references/testing-tools.md`.

---

## Hard Rules

- ❌ **NEVER** use color as the only means of conveying information — always pair with icons, text, or patterns
- ❌ **NEVER** remove focus outlines (`outline: none`) without providing a visible alternative
- ❌ **NEVER** use `innerHTML`/`insertAdjacentHTML` with unsanitized user input
- ✅ **ALWAYS** provide descriptive alt text for informative images and `alt=""` for decorative ones
- ✅ **ALWAYS** maintain a logical heading hierarchy (never skip levels)
- ✅ **ALWAYS** ensure keyboard accessibility for all interactive elements
