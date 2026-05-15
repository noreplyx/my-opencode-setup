---
name: ux-and-testing
description: Security, performance, routing & navigation, error handling, accessibility cross-reference, testing, and logging & telemetry for frontend code.
---

## 6. Security

### 6.1 XSS Prevention

**Never use `innerHTML`, `insertAdjacentHTML`, or `outerHTML` with unsanitized input.**

```js
// ❌ BAD: XSS vulnerability
function renderComment(container, html) {
  container.innerHTML = html;
}

// ✅ GOOD: Sanitize before rendering HTML
function renderSafeComment(container, html) {
  const sanitized = DOMPurify.sanitize(html);
  container.innerHTML = sanitized;
}

// ✅ BETTER: Prefer text content over HTML when possible
function renderCommentText(container, text) {
  container.textContent = text; // Browser auto-escapes
}
```

### 6.2 Input Sanitization

```js
// Sanitize user input at the boundary
function sanitizeInput(value) {
  return value
    .replace(/[<>"']/g, '')       // Strip HTML special chars
    .replace(/javascript:/gi, '') // Strip JS protocol
    .trim();
}

function setupSearchForm(container, { onSubmit }) {
  container.innerHTML = `
    <form id="search-form">
      <input type="text" name="query" maxlength="200" autocomplete="off" />
      <button type="submit">Search</button>
    </form>
  `;

  container.querySelector('#search-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const raw = new FormData(e.target).get('query');
    onSubmit(sanitizeInput(raw));
  });
}
```

### 6.3 Never Expose Secrets

- API keys, tokens, and secrets must live on the server (BFF pattern or environment variables accessed server-side).
- Use a backend-for-frontend (BFF) to proxy API calls and strip sensitive data from responses.

---

## 7. Performance

### 7.1 Memoization

```js
// Memoize expensive computations
function memoize(fn) {
  const cache = new Map();
  return function (...args) {
    const key = JSON.stringify(args);
    if (cache.has(key)) return cache.get(key);
    const result = fn.apply(this, args);
    cache.set(key, result);
    return result;
  };
}

// Usage: avoid recomputing expensive calculations
const calculateTotals = memoize((transactions) => {
  return transactions.reduce((acc, t) => acc + t.amount, 0);
});

// Debounce — prevent rapid repeated execution
function debounce(fn, delayMs) {
  let timer;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delayMs);
  };
}

// Throttle — limit execution rate
function throttle(fn, limitMs) {
  let waiting = false;
  return function (...args) {
    if (waiting) return;
    fn.apply(this, args);
    waiting = true;
    setTimeout(() => { waiting = false; }, limitMs);
  };
}
```

### 7.2 Code Splitting & Dynamic Imports

Use dynamic `import()` to load heavy modules on demand, reducing initial bundle size.

```js
// Lazy-load a heavy module
async function openDashboard(container) {
  container.innerHTML = `<div class="skeleton" aria-busy="true"></div>`;

  try {
    const { renderDashboard } = await import('./dashboard.js');
    renderDashboard(container);
  } catch (err) {
    container.innerHTML = `<div role="alert">Failed to load dashboard. <button onclick="openDashboard(this.parentElement.parentElement)">Retry</button></div>`;
  }
}

// Route-level code splitting (used with a router)
const routeModules = {
  '/dashboard': () => import('./pages/dashboard.js'),
  '/users/:id': () => import('./pages/user-profile.js'),
};
```

### 7.3 Virtualization (Long Lists)

Use windowing / virtual scrolling for large lists to avoid rendering all DOM nodes at once.

```js
/**
 * Virtual list — renders only visible items.
 * Production-ready: use libraries like @tanstack/virtual, or virtual-scroller.
 */
function createVirtualList(container, { items, itemHeight, visibleHeight }) {
  container.style.overflow = 'auto';
  container.style.height = `${visibleHeight}px`;
  container.style.position = 'relative';

  const totalHeight = items.length * itemHeight;
  const spacer = document.createElement('div');
  spacer.style.height = `${totalHeight}px`;
  container.appendChild(spacer);

  function renderVisible() {
    const scrollTop = container.scrollTop;
    const startIdx = Math.floor(scrollTop / itemHeight);
    const endIdx = Math.min(
      startIdx + Math.ceil(visibleHeight / itemHeight) + 1,
      items.length
    );

    // Remove old visible items
    container.querySelectorAll('[data-virtual-item]').forEach(el => el.remove());

    for (let i = startIdx; i < endIdx; i++) {
      const item = document.createElement('div');
      item.dataset.virtualItem = '';
      item.style.position = 'absolute';
      item.style.top = `${i * itemHeight}px`;
      item.style.height = `${itemHeight}px`;
      item.style.width = '100%';
      item.textContent = items[i].label;
      container.appendChild(item);
    }
  }

  container.addEventListener('scroll', renderVisible);
  renderVisible();
}
```

---

## 8. Routing & Navigation

### 8.1 Route Design Principles

- **Flat over nested** — Prefer flat route structures to avoid deep coupling.
- **Colocate route config** — Keep route definitions close to lazy-loaded page modules.
- **Use URL for source of truth** — Filter, sort, and pagination state belongs in URL search params.

### 8.2 Client-Side Routing (History API)

```js
// Minimal router using History API
const routes = [];

function defineRoute(pattern, loader) {
  const paramNames = [];
  const regexStr = pattern.replace(/:(\w+)/g, (_, name) => {
    paramNames.push(name);
    return '([^/]+)';
  });
  routes.push({
    regex: new RegExp(`^${regexStr}$`),
    paramNames,
    loader,
  });
}

async function navigate(path) {
  window.history.pushState({}, '', path);
  await handleRoute(path);
}

async function handleRoute(pathname) {
  const app = document.getElementById('app');
  app.innerHTML = `<div class="page-skeleton" aria-busy="true"></div>`;

  for (const route of routes) {
    const match = pathname.match(route.regex);
    if (match) {
      const params = {};
      route.paramNames.forEach((name, i) => { params[name] = match[i + 1]; });
      try {
        const module = await route.loader();
        module.renderPage(app, params);
      } catch (err) {
        app.innerHTML = `<div role="alert">Failed to load page. <button onclick="navigate('${pathname}')">Retry</button></div>`;
      }
      return;
    }
  }

  app.innerHTML = `<div role="alert">Page not found</div>`;
}

// Handle back/forward
window.addEventListener('popstate', () => handleRoute(location.pathname));

// Define routes
defineRoute('/', () => import('./pages/home.js'));
defineRoute('/dashboard', () => import('./pages/dashboard.js'));
defineRoute('/users/:userId', () => import('./pages/user-profile.js'));
```

### 8.3 Navigation Guards (Auth)

```js
async function requireAuth(guardFn) {
  const isAuthenticated = await guardFn();
  if (!isAuthenticated) {
    navigate('/login');
    return false;
  }
  return true;
}

// Usage in route handler
async function renderSettingsPage(app) {
  const allowed = await requireAuth(() => checkAuth());
  if (!allowed) return;
  const { renderPage } = await import('./pages/settings.js');
  renderPage(app);
}
```

---

## 9. Error Handling

### 9.1 Error Boundary Pattern

Catch rendering errors at a granular level — wrap each major section independently.

```js
function withErrorBoundary(renderFn, fallbackFn) {
  return function (container, ...args) {
    try {
      return renderFn(container, ...args);
    } catch (err) {
      console.error('Render error:', err);
      if (fallbackFn) {
        fallbackFn(container, err);
      } else {
        container.innerHTML = `
          <div role="alert" class="error-boundary">
            <h2>Something went wrong</h2>
            <pre>${escapeHtml(err.message)}</pre>
            <button onclick="location.reload()">Try again</button>
          </div>
        `;
      }
    }
  };
}

// Usage — wrap each major section independently
const safeDashboard = withErrorBoundary(renderDashboard);
safeDashboard(document.getElementById('dashboard'));
```

### 9.2 Graceful Degradation

Always handle the four states: loading → error → empty → success.

```js
async function renderUserProfile(container, userId) {
  // Loading state
  container.innerHTML = `<div class="profile-skeleton" aria-busy="true"></div>`;

  try {
    const user = await fetchUser(userId);

    // Empty state
    if (!user) {
      container.innerHTML = `<div role="alert">User not found</div>`;
      return;
    }

    // Success state
    container.innerHTML = `
      <div class="user-profile">
        <h2>${escapeHtml(user.name)}</h2>
        <p>${escapeHtml(user.email)}</p>
      </div>
    `;
  } catch (err) {
    // Error state
    container.innerHTML = `
      <div role="alert" class="error-state">
        <span class="icon-warning"></span>
        <p>${escapeHtml(err.message)}</p>
        <button onclick="renderUserProfile(this.parentElement, '${userId}')">Retry</button>
      </div>
    `;
  }
}
```

---

## 10. Accessibility (a11y)

> **This section is covered by the dedicated `accessibility` skill.**
>
> For comprehensive accessibility guidance — including WCAG compliance, semantic HTML, ARIA, keyboard navigation, focus management, color contrast, screen reader support, forms, animations, and testing — load and follow the **`accessibility`** skill.
>
> This skill provides both **web (HTML/CSS/JS)** and **Flutter mobile** coverage with platform-specific patterns and testing guidance.

### Frontend-Specific a11y Summary

For quick reference during frontend development, keep these key principles in mind:

1. **Semantic HTML**: Use native HTML elements (`<button>`, `<nav>`, `<main>`, `<header>`, `<h1>`-`<h6>`) before reaching for ARIA.
2. **Labels**: Every form input needs an associated `<label>` or `aria-label`.
3. **Keyboard**: All interactive elements must be reachable and operable via keyboard (Tab, Enter, Space, Arrow keys).
4. **Focus**: Never remove `outline` without providing an alternative visible focus indicator.
5. **Color**: Never convey information through color alone — use icons, text, or patterns as supplements.
6. **Contrast**: WCAG AA requires 4.5:1 for normal text, 3:1 for large text.
7. **Dynamic Content**: Use `aria-live` regions for toasts, errors, and loading announcements.
8. **Testing**: Use `axe-core` for automated a11y checks (see Section 11.3).

> 🔍 **When to load the `accessibility` skill**: During UI implementation, code review, or when running accessibility audits. Load it alongside this skill for the most comprehensive frontend guidance.

---

## 11. Testing Frontend Code

### 11.1 Component Testing (User's Perspective)

Test behavior from the user's perspective — query the rendered DOM, not implementation internals.

```js
// Using a DOM testing library (e.g., @testing-library/dom)
import { getByRole, getByLabelText, fireEvent } from '@testing-library/dom';
import { renderContactForm } from './ContactForm';

describe('ContactForm', () => {
  function setup() {
    const container = document.createElement('div');
    renderContactForm(container, { onSubmit: vi.fn() });
    document.body.appendChild(container);
    return { container };
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('shows validation errors on invalid submission', () => {
    const { container } = setup();
    const sendBtn = getByRole(container, 'button', { name: /send/i });
    fireEvent.click(sendBtn);

    expect(getByRole(container, 'alert')).toHaveTextContent(/name must be at least 2 characters/i);
  });

  it('submits successfully with valid data', async () => {
    const onSubmit = vi.fn();
    const container = document.createElement('div');
    renderContactForm(container, { onSubmit });
    document.body.appendChild(container);

    const nameInput = getByLabelText(container, /name/i);
    const emailInput = getByLabelText(container, /email/i);
    const messageTextarea = getByLabelText(container, /message/i);

    fireEvent.change(nameInput, { target: { value: 'Alice' } });
    fireEvent.change(emailInput, { target: { value: 'alice@example.com' } });
    fireEvent.change(messageTextarea, { target: { value: 'Hello, this is a test message.' } });
    fireEvent.click(getByRole(container, 'button', { name: /send/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Alice',
      email: 'alice@example.com',
      message: 'Hello, this is a test message.',
    });
  });
});
```

### 11.2 E2E Testing (Playwright)

```js
// tests/login.spec.js
import { test, expect } from '@playwright/test';

test.describe('Login flow', () => {
  test('logs in successfully with valid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/email/i).fill('user@example.com');
    await page.getByLabel(/password/i).fill('correct-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page).toHaveURL('/dashboard');
    await expect(page.getByText(/welcome back/i)).toBeVisible();
  });

  test('shows error on invalid credentials', async ({ page }) => {
    await page.goto('/login');

    await page.getByLabel(/email/i).fill('user@example.com');
    await page.getByLabel(/password/i).fill('wrong-password');
    await page.getByRole('button', { name: /sign in/i }).click();

    await expect(page.getByRole('alert')).toContainText(/invalid credentials/i);
  });
});
```

### 11.3 Accessibility Testing

For comprehensive accessibility testing guidance (automated + manual), refer to the **`accessibility` skill**.

**Quick start for component-level a11y testing:**

```js
import { getByRole } from '@testing-library/dom';
import { axe, toHaveNoViolations } from 'axe-core';

expect.extend(toHaveNoViolations);

it('has no accessibility violations', async () => {
  const container = document.createElement('div');
  renderNavigation(container);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

For full testing matrix (screen readers, color blindness simulators, contrast analyzers, platform-specific tools), see the `accessibility` skill's Testing & Verification section.

---

## 12. Logging & Telemetry

### 12.1 Structured Logging

```js
// Logger utility — never use console.log directly in production
const LOG_LEVELS = ['debug', 'info', 'warn', 'error'];

class Logger {
  log(level, message, context = {}) {
    const entry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...context,
    };

    if (process.env.NODE_ENV === 'development') {
      console[level](entry);
    }

    // Send to telemetry service in production
    if (process.env.NODE_ENV === 'production') {
      telemetryService.sendLog(entry);
    }
  }

  info(message, context) { this.log('info', message, context); }
  error(message, context) { this.log('error', message, context); }
  warn(message, context) { this.log('warn', message, context); }
  debug(message, context) { this.log('debug', message, context); }
}

export const logger = new Logger();

// Usage in a UI module
function setupPaymentForm(container) {
  container.querySelector('#payment-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));

    logger.info('Payment form submitted', {
      component: 'PaymentForm',
      action: 'submit',
      metadata: { amount: data.amount },
    });

    try {
      await processPayment(data);
    } catch (err) {
      logger.error('Payment processing failed', {
        component: 'PaymentForm',
        action: 'submit',
        metadata: { error: err.message, amount: data.amount },
      });
    }
  });
}
```

### 12.2 Performance Monitoring

```js
// Report Web Vitals
import { onCLS, onFID, onLCP, onINP } from 'web-vitals';

function reportWebVitals() {
  onCLS((metric) => telemetryService.sendMetric('CLS', metric.value));
  onFID((metric) => telemetryService.sendMetric('FID', metric.value));
  onLCP((metric) => telemetryService.sendMetric('LCP', metric.value));
  onINP((metric) => telemetryService.sendMetric('INP', metric.value));
}

// Render tracking (dev only)
function withRenderTracking(renderFn, name) {
  let renderCount = 0;
  return function (container, ...args) {
    renderCount += 1;
    if (process.env.NODE_ENV === 'development') {
      logger.debug(`Re-render: ${name} (#${renderCount})`);
    }
    return renderFn(container, ...args);
  };
}
```
