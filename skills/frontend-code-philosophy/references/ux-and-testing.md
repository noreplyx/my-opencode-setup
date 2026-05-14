---
name: ux-and-testing
description: Security, performance, routing & navigation, error handling, accessibility cross-reference, testing, and logging & telemetry for frontend code.
---

## 4. Security

### 4.1 XSS Prevention

**Never use `dangerouslySetInnerHTML` or `v-html` with unsanitized input.**

```tsx
// ❌ BAD: XSS vulnerability
function Comment({ html }: { html: string }) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
}

// ✅ GOOD: Sanitize before rendering HTML
import DOMPurify from 'dompurify';

function SafeComment({ html }: { html: string }) {
  const sanitized = useMemo(() => DOMPurify.sanitize(html), [html]);
  return <div dangerouslySetInnerHTML={{ __html: sanitized }} />;
}

// ✅ BETTER: Prefer text rendering over HTML
function CommentText({ text }: { text: string }) {
  return <div>{text}</div>; // React auto-escapes
}
```

### 4.2 Input Sanitization

```tsx
// Sanitize user input at the boundary
function sanitizeInput(value: string): string {
  return value
    .replace(/[<>"']/g, '')       // Strip HTML special chars
    .replace(/javascript:/gi, '') // Strip JS protocol
    .trim();
}

function SearchForm({ onSubmit }: { onSubmit: (query: string) => void }) {
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const raw = new FormData(e.target as HTMLFormElement).get('query') as string;
    onSubmit(sanitizeInput(raw));
  };

  return (
    <form onSubmit={handleSubmit}>
      <input type="text" name="query" maxLength={200} autoComplete="off" />
      <button type="submit">Search</button>
    </form>
  );
}
```

### 4.3 Never Expose Secrets

- API keys, tokens, and secrets must live on the server (BFF pattern or environment variables accessed server-side).
- Use a backend-for-frontend (BFF) to proxy API calls and strip sensitive data from responses.

---

## 5. Performance

### 5.1 Memoization

```tsx
// React.memo — prevent re-render when props haven't changed
const ExpensiveChart = React.memo(function ExpensiveChart({ data }: { data: DataPoint[] }) {
  return <Chart renderData={data} />;
});

// useMemo — memoize expensive computations
function Dashboard({ transactions }: { transactions: Transaction[] }) {
  const totals = useMemo(
    () => transactions.reduce((acc, t) => acc + t.amount, 0),
    [transactions]
  );

  return <div>Total: {formatCurrency(totals)}</div>;
}

// useCallback — memoize callbacks passed to child components
function ProductList({ products }: { products: Product[] }) {
  const handleAddToCart = useCallback((productId: string) => {
    dispatch({ type: 'ADD_TO_CART', payload: productId });
  }, []);

  return products.map((p) => (
    <ProductCard key={p.id} product={p} onAddToCart={handleAddToCart} />
  ));
}
```

### 5.2 Code Splitting & Lazy Loading

**React:**

```tsx
import { lazy, Suspense } from 'react';

const HeavyDashboard = lazy(() => import('./HeavyDashboard'));

function App() {
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      <HeavyDashboard />
    </Suspense>
  );
}
```

**Vue:**

```vue
<script setup lang="ts">
import { defineAsyncComponent } from 'vue';

const HeavyDashboard = defineAsyncComponent(() => import('./HeavyDashboard.vue'));
</script>

<template>
  <Suspense>
    <template #default><HeavyDashboard /></template>
    <template #fallback><DashboardSkeleton /></template>
  </Suspense>
</template>
```

### 5.3 Virtualization (Long Lists)

Use windowing libraries for large lists.

```tsx
import { FixedSizeList } from 'react-window';

function VirtualUserList({ users }: { users: User[] }) {
  return (
    <FixedSizeList
      height={600}
      itemCount={users.length}
      itemSize={72}
      width="100%"
    >
      {({ index, style }) => (
        <div style={style}>
          <UserListItem user={users[index]} />
        </div>
      )}
    </FixedSizeList>
  );
}
```

---

## 8. Routing & Navigation

### 8.1 Route Design Principles

- **Flat over nested** — Prefer flat route structures to avoid deep nesting.
- **Colocate route config** — Keep route definitions close to lazy-loaded page components.
- **Use URL for source of truth** — Filter, sort, and pagination state belongs in URL search params.

### 8.2 Lazy Loading Routes

```tsx
// React Router v6 with lazy routes
const routes: RouteObject[] = [
  {
    path: '/',
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      {
        path: 'dashboard',
        lazy: () => import('./pages/Dashboard'), // Route-level code splitting
      },
      {
        path: 'users/:userId',
        lazy: () => import('./pages/UserProfile'),
      },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];

function AppRouter() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <RouterProvider router={createBrowserRouter(routes)} />
    </Suspense>
  );
}
```

### 8.3 Navigation Guards (Auth)

```tsx
function ProtectedRoute({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();

  if (isLoading) return <PageSkeleton />;
  if (!user) return <Navigate to="/login" replace />;

  return <>{children}</>;
}

// Usage in route config
{
  path: 'settings',
  element: (
    <ProtectedRoute>
      <SettingsPage />
    </ProtectedRoute>
  ),
}
```

---

## 9. Error Handling

### 9.1 Error Boundary Component

```tsx
import { ErrorBoundary } from 'react-error-boundary';

function ErrorFallback({ error, resetErrorBoundary }: { error: Error; resetErrorBoundary: () => void }) {
  return (
    <div role="alert" className="error-boundary">
      <h2>Something went wrong</h2>
      <pre>{error.message}</pre>
      <button onClick={resetErrorBoundary}>Try again</button>
    </div>
  );
}

// Usage — wrap each major section independently
function App() {
  return (
    <ErrorBoundary FallbackComponent={ErrorFallback} onReset={() => window.location.reload()}>
      <Dashboard />
    </ErrorBoundary>
  );
}
```

### 9.2 Graceful Degradation

```tsx
function UserProfile({ userId }: { userId: string }) {
  const { data: user, isLoading, isError, error, refetch } = useUser(userId);

  if (isLoading) return <UserProfileSkeleton />;
  if (isError) return <ErrorState message={error.message} onRetry={refetch} />;
  if (!user) return <NotFound />;

  return <UserDetails user={user} />;
}

// Reusable error state
function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="error-state">
      <Icon name="warning" />
      <p>{message}</p>
      <button onClick={onRetry}>Retry</button>
    </div>
  );
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
8. **Testing**: Use `jest-axe` for automated a11y checks in component tests (see Section 11.3).

> 🔍 **When to load the `accessibility` skill**: During UI implementation, code review, or when running accessibility audits. Load it alongside this skill for the most comprehensive frontend guidance.

---

## 11. Testing Frontend Code

### 11.1 Component Testing (React Testing Library)

Test behavior from the user's perspective, not implementation details.

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ContactForm } from './ContactForm';

describe('ContactForm', () => {
  it('shows validation errors on invalid submission', async () => {
    const user = userEvent.setup();
    render(<ContactForm />);

    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(screen.getByText(/name must be at least 2 characters/i)).toBeInTheDocument();
    expect(screen.getByText(/enter a valid email/i)).toBeInTheDocument();
  });

  it('submits successfully with valid data', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    render(<ContactForm onSubmit={onSubmit} />);

    await user.type(screen.getByLabelText(/name/i), 'Alice');
    await user.type(screen.getByLabelText(/email/i), 'alice@example.com');
    await user.type(screen.getByLabelText(/message/i), 'Hello, this is a test message.');
    await user.click(screen.getByRole('button', { name: /send/i }));

    expect(onSubmit).toHaveBeenCalledWith({
      name: 'Alice',
      email: 'alice@example.com',
      message: 'Hello, this is a test message.',
    });
  });
});
```

### 11.2 E2E Testing (Playwright)

```ts
// tests/login.spec.ts
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

```tsx
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

it('has no accessibility violations', async () => {
  const { container } = render(<Navigation />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

For full testing matrix (screen readers, color blindness simulators, contrast analyzers, platform-specific tools), see the `accessibility` skill's Testing & Verification section.

---

## 12. Logging & Telemetry

### 12.1 Structured Logging

```tsx
// Logger utility — never use console.log directly in production
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  component?: string;
  action?: string;
  metadata?: Record<string, unknown>;
}

class Logger {
  private log(level: LogLevel, message: string, context?: Partial<LogEntry>) {
    const entry: LogEntry = {
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

  info(message: string, context?: Partial<LogEntry>) {
    this.log('info', message, context);
  }

  error(message: string, context?: Partial<LogEntry>) {
    this.log('error', message, context);
  }
}

export const logger = new Logger();

// Usage in a component
function PaymentForm() {
  const handleSubmit = async (data: PaymentData) => {
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
  };
}
```

### 12.2 Performance Monitoring

```tsx
// Report Web Vitals
import { onCLS, onFID, onLCP, onINP } from 'web-vitals';

function reportWebVitals() {
  onCLS((metric) => telemetryService.sendMetric('CLS', metric.value));
  onFID((metric) => telemetryService.sendMetric('FID', metric.value));
  onLCP((metric) => telemetryService.sendMetric('LCP', metric.value));
  onINP((metric) => telemetryService.sendMetric('INP', metric.value));
}

// Component render tracking (dev only)
function withRenderTracking<T extends object>(Component: React.ComponentType<T>, name: string) {
  return function TrackedComponent(props: T) {
    const renderCount = useRef(0);
    renderCount.current += 1;

    useEffect(() => {
      if (process.env.NODE_ENV === 'development') {
        logger.debug(`Re-render: ${name} (#${renderCount.current})`);
      }
    });

    return <Component {...props} />;
  };
}
```
