---
name: accessibility-testing-tools
description: Consolidated accessibility testing tools, manual testing checklists, assistive technology matrices, and CI/CD integration guidance for both web and Flutter projects.
---

# Accessibility Testing Tools Reference

> Consolidated testing guidance for both web and Flutter accessibility verification. Load this when setting up testing infrastructure or performing accessibility audits.

## Table of Contents

- [1. Web Testing Tools](#1-web-testing-tools)
- [2. Flutter Testing Tools](#2-flutter-testing-tools)
- [3. Manual Testing Checklist](#3-manual-testing-checklist)
- [4. Assistive Technology Testing Matrix](#4-assistive-technology-testing-matrix)
- [5. CI/CD Integration](#5-cicd-integration)

---

## 1. Web Testing Tools

| Tool | Purpose | Integration |
|------|---------|-------------|
| **aXe** | Automated WCAG violation detection | Browser extension, CI/CD via axe-core |
| **Lighthouse Accessibility** | Automated audit with scoring | Built into Chrome DevTools, CI via Lighthouse CI |
| **WAVE** | Visual accessibility overlay | Browser extension, API for automation |
| **pa11y** | CI-friendly automated a11y testing | CLI tool, CI pipeline integration |
| **eslint-plugin-jsx-a11y** | Static analysis for React JSX | ESLint plugin, lint-on-save |

---

## 2. Flutter Testing Tools

| Tool | Platform | Purpose |
|------|----------|---------|
| `flutter_test` semantics API | Dart | Programmatic semantics tree assertions |
| `flutter_test` a11y matchers | Dart | Built-in guidelines (`labeledTapTargetGuideline`, `androidTapTargetGuideline`, etc.) |
| **Accessibility Scanner** | Android | Automated a11y audit app for Android |
| **Xcode Accessibility Inspector** | iOS | iOS accessibility tree inspection |

### Flutter Test Guidelines Reference

| Guideline | Purpose |
|-----------|---------|
| `androidTapTargetGuideline` | All tappable widgets ≥ 48dp |
| `iOSTapTargetGuideline` | All tappable widgets ≥ 44pt |
| `labeledTapTargetGuideline` | All tappable widgets have semantics label |
| `ensureSemanticLabels` | No duplicate labels on same screen |
| `contrastGuideline` | Basic color contrast check (limited) |

### Flutter Semantics Test Example

```dart
testWidgets('Button has correct semantics label', (tester) async {
  await tester.pumpWidget(MaterialApp(home: MyScreen()));

  // Find the button and check its semantics
  final semantics = tester.getSemantics(find.byType(ElevatedButton));
  expect(semantics.label, 'Submit order');
  expect(semantics.isButton, true);
  expect(semantics.isEnabled, true);
});
```

```dart
testWidgets('Semantics tree is correct', (tester) async {
  await tester.pumpWidget(MyApp());

  // Check that no semantics nodes have conflicting or missing labels
  final handle = tester.ensureSemantics();
  expect(tester, meetsGuideline(androidTapTargetGuideline));
  expect(tester, meetsGuideline(iOSTapTargetGuideline));
  expect(tester, meetsGuideline(labeledTapTargetGuideline));
  expect(tester, meetsGuideline(ensureSemanticLabels));
  expect(tester, meetsGuideline(contrastGuideline));
  handle.dispose();
});
```

---

## 3. Manual Testing Checklist

### Web Manual Tests

- [ ] Navigate the entire application using only a keyboard (Tab, Enter, Space, Arrow keys).
- [ ] Test with a screen reader (NVDA on Windows, VoiceOver on macOS, JAWS if available).
- [ ] Test with browser zoom at 200% and 400%.
- [ ] Test with high contrast mode enabled (`prefers-contrast: high`).
- [ ] Test with dark mode enabled (`prefers-color-scheme: dark`).

### Flutter Manual Tests

- [ ] Navigate the entire app using **TalkBack** (Android) or **VoiceOver** (iOS) — no visual guidance.
- [ ] Test with **system font size** set to Largest (Settings → Accessibility → Font size).
- [ ] Test with **bold text** enabled (Settings → Accessibility → Bold text).
- [ ] Test with **high contrast** enabled (Android: High contrast text; iOS: Increase Contrast).
- [ ] Test with **reduced motion** enabled (iOS: Reduce Motion; Android: Remove animations).
- [ ] Test with **color correction/filters** enabled (Android: Color correction; iOS: Color filters).
- [ ] Test on **small screens** (e.g., 4.7" iPhone SE) and **large screens** (tablets).
- [ ] Test with **orientation changes** (portrait ↔ landscape).
- [ ] Test with a **physical keyboard** connected if your app supports it.
- [ ] Test **custom gestures** ensure there's an alternative non-gesture path.

---

## 4. Assistive Technology Testing Matrix

| Tool | Platform | Use Case |
|------|----------|----------|
| NVDA | Windows | Primary screen reader testing (web) |
| VoiceOver | macOS | Safari screen reader testing (web) |
| JAWS | Windows | Enterprise screen reader (web, if available) |
| **TalkBack** | **Android** | **Primary mobile screen reader (Flutter)** |
| **VoiceOver** | **iOS** | **Primary mobile screen reader (Flutter)** |
| **Accessibility Scanner** | **Android** | **Automated a11y audit for Flutter apps** |
| **Xcode Accessibility Inspector** | **iOS** | **iOS accessibility tree inspection** |
| TalkBack | Android | Mobile screen reader testing |
| Orca | Linux | Linux screen reader testing (web) |
| **Sim Daltonism** | **macOS** | **Color blindness simulation** |
| **Colour Contrast Analyser** | **Desktop** | **WCAG contrast ratio checking** |

---

## 5. CI/CD Integration

### Web CI

- Integrate **aXe**, **Lighthouse Accessibility**, or **WAVE** into CI/CD pipelines.
- Use `eslint-plugin-jsx-a11y` for React projects with lint-on-build.

### Flutter CI

- Run `flutter test` with a11y matchers in your CI pipeline.
- Use `flutter analyze` for lint rules.

### Static Analysis (check-a11y.ts)

The skill's `check-a11y.ts` script exits with code 1 if any critical or high-severity issues are found:

```bash
# Run the a11y checker after UI development
ts-node skills/scripts/accessibility/check-a11y.ts --dir=./
ts-node skills/scripts/accessibility/check-a11y.ts --dir=./ --verbose
```

**WCAG Violations Detected:**

| WCAG | Issue | Severity |
|------|-------|----------|
| 1.1.1 | Images missing alt attribute | Critical |
| 1.3.1 | Form inputs without accessible labels | High |
| 2.1.1 / 4.1.2 | Non-semantic elements (div/span) used as clickable elements | High |
| 3.1.1 | Missing lang attribute on `<html>` | High |
| 2.4.7 | Focus outline removed without replacement | High |
| 1.4.1 | Color used as only means of conveying information | Medium |
| 4.1.3 | Dynamic content without aria-live region | Medium |

The script exits with code 1 if any critical or high-severity issues are found.
