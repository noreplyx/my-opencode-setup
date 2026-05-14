---
name: accessibility
description: Use this skill when planning or implementing UI code (web or Flutter mobile) to ensure applications are accessible to all users, including those with disabilities, following WCAG standards, platform-specific best practices, and accessibility testing guidelines.
---

# Accessibility (a11y) Philosophy

This skill ensures that all user interfaces — **web (HTML/CSS/JS) and Flutter mobile (Android/iOS)** — are designed and implemented to be usable by people with diverse abilities, following the Web Content Accessibility Guidelines (WCAG) and established accessibility best practices for each platform.

> **Platform Scope**: Sections 1–9 apply primarily to **web**. Inline callouts (📱 **Flutter**) highlight where Flutter differs. Section 10 covers **Flutter-specific** implementation in depth.
> **Common Principles**: WCAG's POUR principles (Perceivable, Operable, Understandable, Robust) apply equally to both web and mobile applications.

---

## 1. WCAG Compliance Levels

Strive for at minimum **WCAG 2.1 Level AA** compliance (applies to both web and mobile):

| Principle | Guideline | Web Examples | Flutter Examples |
|-----------|-----------|--------------|------------------|
| **Perceivable** | Information must be presentable to users in ways they can perceive | Alt text, captions, adaptable layouts | `Semantics` labels, `excludeSemantics`, media captions |
| **Operable** | UI components must be operable by all users | Keyboard navigation, sufficient time, no seizures | TalkBack/VoiceOver gestures, focus traversal, timer controls |
| **Understandable** | Information and UI must be understandable | Readable text, predictable behavior, input assistance | `MediaQuery.textScaleFactor`, predictable navigation, input helpers |
| **Robust** | Content must be interpretable by assistive technologies | Semantic HTML, ARIA compatibility | Flutter's built-in Semantics tree, platform channels |

📱 **Flutter note**: WCAG 2.1 Level AA is the target for mobile apps as well. Android uses TalkBack, iOS uses VoiceOver as the primary screen readers.

---

## 2. Semantic Structure

### Web: Semantic HTML
- Use native HTML elements with built-in accessibility (e.g., `<button>`, `<nav>`, `<main>`, `<header>`, `<footer>`, `<article>`, `<section>`).
- Use heading levels (`<h1>`–`<h6>`) in a logical, hierarchical order (never skip levels).
- Use `<label>` elements properly associated with form inputs via `for` attribute or wrapping.
- Use `<table>` only for tabular data, not layout. Include `<caption>`, `<thead>`, `<tbody>`, `<th>` with `scope`.

### 📱 Flutter: Semantics Widget
- Flutter automatically generates a **Semantics tree** from the widget tree.
- Use the **`Semantics` widget** to override or enhance accessibility info:

```dart
Semantics(
  label: 'Submit order for $total items',
  hint: 'Double tap to place your order',
  button: true,
  enabled: isFormValid,
  onTap: submitOrder,
  child: ElevatedButton(...),
)
```

- Use **`mergeSemantics`** to group children as a single focusable element (e.g., a card with text and an icon).
- Use **`excludeSemantics`** to hide purely decorative elements from screen readers (equivalent to `alt=""` in HTML).
- **Heading hierarchy**: Use `Semantics(headingLevel: ...)` to create heading levels (`HeadingLevel.h1` to `HeadingLevel.h6`). Maintain a logical hierarchy just like HTML headings.
- **Lists**: Use `Semantics(sortKey: ...)` and `Semantics(label: ...)` on list items to ensure proper list semantics.

---

## 3. ARIA vs Flutter Semantics Properties

### Web: ARIA (Accessible Rich Internet Applications)
- **First Rule of ARIA**: Don't use ARIA if you can use a native HTML element that provides the semantics and behavior you need.
- Use ARIA roles, states, and properties only when native semantics are insufficient:
  - `role="alert"` for dynamic important messages
  - `aria-label`, `aria-labelledby` for elements without visible labels
  - `aria-describedby` for additional descriptions
  - `aria-expanded`, `aria-controls` for expandable content
  - `aria-live="polite"` / `aria-live="assertive"` for dynamic content updates
- **Never** override native semantics (e.g., don't add `role="button"` to a `<button>`).

### 📱 Flutter: Semantics Properties

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

**Flutter-specific semantics properties:**

```dart
Semantics(
  label: 'Temperature',
  value: '72 degrees',
  increasedValue: '73 degrees',   // accessibility actions
  decreasedValue: '71 degrees',
  onIncrease: () => increaseTemp(),
  onDecrease: () => decreaseTemp(),
  child: CustomTemperatureControl(),
)
```

---

## 4. Focus & Keyboard / Gesture Accessibility

### Web: Keyboard Navigation
- All interactive elements must be keyboard accessible (Tab, Enter, Space, Arrow keys).
- Maintain a logical tab order matching the visual layout (use `tabindex="0"` or `tabindex="-1"`; avoid positive tabindex values).
- Provide visible focus indicators on all interactive elements (never use `outline: none` without a replacement).
- Implement custom keyboard navigation patterns for complex widgets (e.g., arrow key navigation in menus, tabs, grids).
- Ensure no keyboard traps — users must be able to navigate away from any element using the keyboard.

### 📱 Flutter: Focus & Gesture Accessibility
- Flutter uses **focus traversal** for keyboard (physical keyboard on Android/iOS) and directional pad navigation.
- **`FocusTraversalGroup`**: Groups widgets into logical focus regions (like HTML's `tabindex` grouping).
- **`FocusTraversalOrder`**: Sets the order within a group using `TraversalOrder` (numeric ordering).

```dart
FocusTraversalGroup(
  policy: OrderedTraversalPolicy(),
  child: Column(
    children: [
      FocusTraversalOrder(order: NSKeyValueObservingOldValue(1), child: TextField(...)),
      FocusTraversalOrder(order: NSKeyValueObservingOldValue(2), child: TextField(...)),
      FocusTraversalOrder(order: NSKeyValueObservingOldValue(3), child: ElevatedButton(...)),
    ],
  ),
)
```

- **`Focus` widget**: Manages raw focus for custom widgets.
- **`Autofocus`**: Automatically focuses a widget when it's first shown (e.g., first text field in a form).
- **Focus indicators**: Flutter provides default focus highlights; always preserve or customize them for custom widgets.
- **Physical keyboard support**: Flutter supports hardware keyboards on Android/iOS. Ensure all interactive elements are reachable via Tab/Arrow keys.
- **No gesture traps**: Always provide alternative gesture paths when using complex gesture detectors (e.g., swipe-to-delete should also be achievable via a button/long-press).

---

## 5. Color & Contrast

### Web
- **Color Contrast Ratio** (WCAG AA):
  - Normal text (<18pt / <14pt bold): Minimum 4.5:1
  - Large text (≥18pt / ≥14pt bold): Minimum 3:1
  - UI components and graphical objects: Minimum 3:1
- **Never** use color as the only means of conveying information (add icons, text labels, or patterns).
- Support **high contrast mode** (`prefers-contrast: high`) and **dark mode** (`prefers-color-scheme: dark`).
- Test with color blindness simulators (protanopia, deuteranopia, tritanopia).

### 📱 Flutter
- The same WCAG contrast ratios apply (4.5:1 normal text, 3:1 large text, 3:1 UI components).
- **Theme-based contrast**: Use Flutter's `ThemeData` with proper `ColorScheme` to manage light/dark/high-contrast themes.

```dart
ThemeData(
  colorScheme: ColorScheme.fromSeed(
    seedColor: primaryColor,
    brightness: Brightness.light,
    contrastLevel: 0.5, // 0.0–1.0; higher = more contrast
  ),
)
```

- **`MediaQuery.platformBrightness`** and **`MediaQuery.highContrast`**: Detect system-level contrast settings (iOS: Increased Contrast; Android: High contrast text).

```dart
final highContrast = MediaQuery.highContrastOf(context);
final brightness = MediaQuery.platformBrightnessOf(context);
```

- **Never convey information by color alone**: Use icons, text labels, or `Semantics` labels alongside color.
- **`FlexibleColorScheme`** or custom `ThemeExtension` can enforce accessible contrast across the app.
- Test with **color blindness simulators**: Use platform accessibility settings (Android: Color correction; iOS: Color filters) and tools like **Sim Daltonism** or **Accessibility Scanner** (Android).

---

## 6. Screen Reader Support

### Web
- Provide descriptive **alt text** for all images:
  - Informative images: Describe the content and function.
  - Decorative images: Use `alt=""` (empty) to hide from screen readers.
  - Complex images (charts, graphs): Provide a text summary or data table alternative.
- Use `aria-live` regions for dynamic content updates (loading states, error messages, toasts).
- Announce route changes in single-page applications to screen readers.
- Provide skip navigation links (`<a href="#main-content">Skip to main content</a>`).
- Ensure proper focus management for modals, dialogs, and single-page app transitions.

### 📱 Flutter
- Flutter integrates natively with **TalkBack** (Android) and **VoiceOver** (iOS) through the automatically generated Semantics tree.
- **Semantics labels**: Every interactive widget should have a meaningful `Semantics(label: ...)`. Text widgets get their text automatically.

```dart
// Bad
Icon(Icons.settings)

// Good
Semantics(
  label: 'Settings',
  child: Icon(Icons.settings),
)
```

- **Live regions**: Use `Semantics(liveRegion: true)` for dynamic content that should announce changes immediately (toasts, error messages, loading indicators).

```dart
Semantics(
  liveRegion: true,
  child: Text('Item added to cart'),
)
```

- **Route announcements**: Use `Semantics(route: true, label: 'Profile page')` to announce page transitions.
- **Skip navigation**: Flutter doesn't have a native "skip to content" mechanism, but you can implement one:
  - Add a `Focus` node at the top of your content area
  - Provide a button that moves focus to main content (hidden until focused, like HTML's skip link pattern)
- **Modal/Dialog focus**: Flutter's `showDialog` and `showModalBottomSheet` automatically manage focus trapping. Always use these rather than custom overlay solutions.
- **Images**: Use `Semantics(label: ...)` on `Image` widgets for informative images; `excludeSemantics` for decorative ones.
- **CustomPaint/Canvas**: Must be wrapped in `Semantics` — canvas-rendered elements have no automatic semantics.

---

## 7. Forms & Input

### Web
- Every input must have an associated label (visible, not placeholder-only).
- Group related inputs with `<fieldset>` and `<legend>`.
- Provide clear error messages that identify which field has an error and how to fix it.
- Use `aria-invalid`, `aria-errormessage` for error states.
- Ensure autocomplete attributes for common fields (`autocomplete="email"`, `autocomplete="address-line1"`, etc.).

### 📱 Flutter
- Every `TextField` and `TextFormField` should have a **label** (`InputDecoration(labelText: ...)`) and/or **semantics label**.
- Use `InputDecoration(helperText: ...)` for descriptions and `InputDecoration(errorText: ...)` for errors.
- Flutter automatically associates labels and error text in the semantics tree.

```dart
TextField(
  decoration: InputDecoration(
    labelText: 'Email address',
    hintText: 'you@example.com',
    errorText: hasError ? 'Please enter a valid email' : null,
    helperText: 'We will never share your email',
  ),
  keyboardType: TextInputType.emailAddress,
  autofillHints: [AutofillHints.email],
)
```

- **Grouping related inputs**: Use `Semantics` with `sortKey` or `mergeSemantics` to group related fields. Use `Column` with `FocusTraversalGroup` for logical field ordering.
- **Error announcements**: Wrap error text in `Semantics(liveRegion: true)` so screen readers announce validation errors immediately.
- **Autofill**: Use `autofillHints` parameter — maps to the platform's autofill framework (Android Autofill, iOS Keychain).

| Flutter `autofillHints` | HTML `autocomplete` |
|-------------------------|---------------------|
| `AutofillHints.email` | `autocomplete="email"` |
| `AutofillHints.password` | `autocomplete="current-password"` |
| `AutofillHints.name` | `autocomplete="name"` |
| `AutofillHints.telephoneNumber` | `autocomplete="tel"` |
| `AutofillHints.streetAddressLine1` | `autocomplete="address-line1"` |
| `AutofillHints.postalCode` | `autocomplete="postal-code"` |

- **Custom form widgets**: Wrap in `Semantics` with appropriate properties (`textField: true`, `button: true`, `slider: true`, etc.).

---

## 8. Responsive & Adaptive (Mobile)

### Web
- Support zoom up to 400% without loss of content or functionality.
- Ensure content reflows in a single column at 320px width (no horizontal scrolling).
- Use relative units (rem, em, %) over fixed units (px) where appropriate.
- Test with screen magnification tools and different viewport sizes.

### 📱 Flutter
- **Text scaling**: Use `MediaQuery.textScaleFactorOf(context)` to respect system font size settings (iOS: Dynamic Type; Android: Font size).
- **Avoid hardcoded font sizes** — use `Theme.of(context).textTheme` which automatically scales with system settings.

```dart
// Bad — ignores system font size
Text('Hello', style: TextStyle(fontSize: 16))

// Good — uses theme text style (respects system scaling)
Text('Hello', style: Theme.of(context).textTheme.bodyLarge)

// Custom with scaling factor
Text('Hello', style: TextStyle(fontSize: 16 * MediaQuery.textScaleFactorOf(context)))
```

- **`MediaQuery.alwaysUse24HourFormatOf(context)`**: Respect system time format preferences.
- **Layout adaptation**: Use `LayoutBuilder`, `MediaQuery`, and `OrientationBuilder` to adapt to screen sizes and orientations.
- **Minimum touch targets**: All interactive elements should be at least **48×48dp** (Material Design guideline). Use `MaterialTapTargetSize` to adjust.
- **Gesture alternatives**: Provide long-press or button alternatives for swipe/gesture-based interactions.
- **`MediaQuery.boldTextOf(context)`**: Detect if system bold text is enabled.
- **`MediaQuery.accessibleNavigationOf(context)`**: Detect if TalkBack/VoiceOver (or similar) is active. Use this to conditionally simplify complex gesture interactions.

---

## 9. Flutter-Specific Animations & Motion

- **Respect `MediaQuery.disableAnimations`**: When the user has disabled animations at the system level, reduce or disable custom animations/transitions.

```dart
final disableAnimations = MediaQuery.disableAnimationsOf(context);
return AnimatedContainer(
  duration: disableAnimations ? Duration.zero : Duration(milliseconds: 300),
  ...
);
```

- **Reduced motion**: On iOS, `MediaQuery.prefersReducedMotion` maps to the "Reduce Motion" accessibility setting. On Android, use `disableAnimations`.
- **Avoid flashing/strobing effects** (WCAG 2.3.1 — Three Flashes or Below Threshold). This applies to both platforms.
- **Provide pause/stop controls** for auto-playing animations, carousels, or videos.

---

## 10. Testing & Verification

### Automated Testing

#### Web
- Integrate **aXe**, **Lighthouse Accessibility**, or **WAVE** into CI/CD pipelines.
- Use `eslint-plugin-jsx-a11y` for React projects.

#### 📱 Flutter
- **`flutter_test` with semantics**: Use `tester.getSemantics(find.byType(MyWidget))` to verify semantics tree structure.

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

- **`flutter_test` a11y matchers**: Use built-in accessibility checks.

```dart
import 'package:flutter_test/flutter_test.dart';

testWidgets('Semantics tree is correct', (tester) async {
  await tester.pumpWidget(MyApp());

  // Check that no semantics nodes have conflicting or missing labels
  final handle = tester.ensureSemantics();
  expect(tester, meetsGuideline(androidTapTargetGuideline));   // Android: 48dp touch targets
  expect(tester, meetsGuideline(iOSTapTargetGuideline));       // iOS: 44pt touch targets
  expect(tester, meetsGuideline(labeledTapTargetGuideline));   // All tappable must have label
  expect(tester, meetsGuideline(ensureSemanticLabels));        // No conflicting labels

  // Check text contrast (basic)
  expect(tester, meetsGuideline(contrastGuideline));
  handle.dispose();
});
```

| Flutter Test Guideline | Purpose |
|------------------------|---------|
| `androidTapTargetGuideline` | All tappable widgets ≥ 48dp |
| `iOSTapTargetGuideline` | All tappable widgets ≥ 44pt |
| `labeledTapTargetGuideline` | All tappable widgets have semantics label |
| `ensureSemanticLabels` | No duplicate labels on same screen |
| `contrastGuideline` | Basic color contrast check (limited) |

- **`Accessibility Scanner`** (Android): Install the app, run Accessibility Scanner to get automated a11y reports.
- **Xcode Accessibility Inspector** (iOS): Use Xcode's built-in tool to inspect the iOS accessibility tree.
- **CI/CD integration**: Run `flutter test` with a11y matchers in your pipeline. Consider `flutter analyze` for lint rules.

### Manual Testing

#### Web
- Navigate the entire application using only a keyboard.
- Test with a screen reader (NVDA, VoiceOver, JAWS).
- Test with browser zoom at 200% and 400%.
- Test with high contrast mode enabled.

#### 📱 Flutter
- Navigate the entire app using **TalkBack** (Android) or **VoiceOver** (iOS) — no visual guidance.
- Test with **system font size** set to Largest (Settings → Accessibility → Font size).
- Test with **bold text** enabled (Settings → Accessibility → Bold text).
- Test with **high contrast** enabled (Android: High contrast text; iOS: Increase Contrast).
- Test with **reduced motion** enabled (iOS: Reduce Motion; Android: Remove animations).
- Test with **color correction/filters** enabled (Android: Color correction; iOS: Color filters).
- Test on **small screens** (e.g., 4.7" iPhone SE) and **large screens** (tablets).
- Test with **orientation changes** (portrait ↔ landscape).
- Test with a **physical keyboard** connected if your app supports it.
- Test **custom gestures** ensure there's an alternative non-gesture path.

### Assistive Technology Testing Matrix

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

## 11. Flutter-Specific Implementation Checklist

Beyond the sections above, use this checklist when implementing or auditing a Flutter app:

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
3. **Propose**: Suggest fixes following accessibility best practices for the relevant platform.
4. **Verify**: Re-run automated tests and perform manual testing with assistive technology (TalkBack, VoiceOver, NVDA, etc.) to confirm the fix.

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
