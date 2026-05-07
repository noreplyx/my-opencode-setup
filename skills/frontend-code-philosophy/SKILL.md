---
name: frontend-code-philosophy
description: Use this skill when planning or implementing frontend code to ensure UI implementation adheres to clean code, clean architecture, SOLID principles, best practices, security, performance, logging (telemetry), skeleton patterns, and ensures rendering methods contain no business logic.
---

# Frontend Code Philosophy

This skill provides a comprehensive set of frontend-specific guidelines that supplement the universal `code-philosophy` skill. It covers React, Vue, and vanilla JavaScript UI patterns with practical code examples, ensuring consistent, maintainable, accessible, and performant user interfaces.

## Relationship to code-philosophy

This skill is a **frontend-specific supplement** to the universal `code-philosophy` skill. All principles from `code-philosophy` (SOLID, Clean Code, Clean Architecture, Best Practices, Security, Performance, Logging & Telemetry) apply equally to frontend code. This skill covers additional concerns unique to UI development.

When both skills apply, this skill's guidance takes precedence for frontend-specific patterns.

---

## 1. Presentation Layer

### 1.1 Pure Rendering Components

Rendering methods/functions **must be pure** — they transform state/props into a visual representation and **must NOT contain business logic**. Business logic belongs in custom hooks, services, or state management layers.

**React (Bad — business logic in render):**

```tsx
// ❌ BAD: Data transformation in render
function UserProfile({ userId }: { userId: string }) {
  const [user, setUser] = useState<User | null>(null);

  // Business logic in the component body
  const fullName = user
    ? `${user.firstName} ${user.lastName}`.toUpperCase()
    : '';

  if (!user) return <Spinner />;
  return <div>{fullName}</div>;
}
```

**React (Good — logic extracted to a hook):**

```tsx
// ✅ GOOD: Pure rendering component
function UserProfile({ userId }: { userId: string }) {
  const { user, isLoading } = useUser(userId);

  if (isLoading) return <Spinner />;
  if (!user) return <NotFound />;

  return (
    <div>
      <UserAvatar src={user.avatarUrl} alt={user.displayName} />
      <UserName name={user.displayName} />
    </div>
  );
}

// Hook isolates business logic
function useUser(id: string) {
  const { data: user, isLoading } = useQuery({
    queryKey: ['user', id],
    queryFn: () => fetchUser(id),
  });
  return { user, isLoading };
}
```

**Vue (Good — pure template):**

```vue
<template>
  <div v-if="isLoading"><Spinner /></div>
  <div v-else-if="!user"><NotFound /></div>
  <div v-else>
    <UserAvatar :src="user.avatarUrl" :alt="user.displayName" />
    <UserName :name="user.displayName" />
  </div>
</template>

<script setup lang="ts">
// Composition API separates concerns
const props = defineProps<{ userId: string }>();
const { data: user, isLoading } = useUser(props.userId);
</script>
```

### 1.2 Skeleton / Shimmer Pattern

Improve perceived performance during loading states with skeleton screens. Never show a blank or janky loading spinner without context.

**React Skeleton Component:**

```tsx
// Skeleton.tsx — reusable skeleton base
interface SkeletonProps {
  width?: string;
  height?: string;
  borderRadius?: string;
  className?: string;
}

function Skeleton({ width = '100%', height = '1rem', borderRadius = '4px', className }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className ?? ''}`}
      style={{ width, height, borderRadius }}
      aria-hidden="true"
    />
  );
}

// CSS
// .skeleton {
//   background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
//   background-size: 200% 100%;
//   animation: shimmer 1.5s infinite;
// }
// @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

// Usage in a page skeleton
function UserProfileSkeleton() {
  return (
    <div role="status" aria-label="Loading user profile">
      <Skeleton width="48px" height="48px" borderRadius="50%" />
      <Skeleton width="60%" height="1.5rem" />
      <Skeleton width="40%" height="1rem" />
      <span className="sr-only">Loading...</span>
    </div>
  );
}
```

---

## 2. Component Design Patterns

### 2.1 Container / Presentational Pattern

Separate data-fetching (container) from rendering (presentational). Containers know about data sources; presentational components receive data via props and are highly reusable.

```tsx
// Presentational — pure, reusable, testable
interface UserListProps {
  users: User[];
  onSelect: (user: User) => void;
  isLoading: boolean;
}

function UserList({ users, onSelect, isLoading }: UserListProps) {
  if (isLoading) return <UserListSkeleton />;
  if (users.length === 0) return <EmptyState message="No users found" />;

  return (
    <ul role="list">
      {users.map((user) => (
        <UserListItem key={user.id} user={user} onSelect={onSelect} />
      ))}
    </ul>
  );
}

// Container — data-aware, orchestrates side effects
function UserListPage() {
  const { data: users, isLoading } = useUsers();
  const navigate = useNavigate();

  const handleSelect = (user: User) => {
    trackEvent('user_selected', { userId: user.id });
    navigate(`/users/${user.id}`);
  };

  return <UserList users={users ?? []} onSelect={handleSelect} isLoading={isLoading} />;
}
```

### 2.2 Compound Components

Related components that share implicit state via React Context without prop drilling.

```tsx
// ✅ GOOD: Compound component pattern
interface AccordionContextValue {
  expandedId: string | null;
  toggle: (id: string) => void;
}

const AccordionContext = createContext<AccordionContextValue | null>(null);

function Accordion({ children }: { children: ReactNode }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const toggle = (id: string) => setExpandedId((prev) => (prev === id ? null : id));

  return (
    <AccordionContext.Provider value={{ expandedId, toggle }}>
      <div className="accordion">{children}</div>
    </AccordionContext.Provider>
  );
}

Accordion.Item = function AccordionItem({ id, title, children }: AccordionItemProps) {
  const ctx = useContext(AccordionContext)!;
  const isExpanded = ctx.expandedId === id;

  return (
    <div className="accordion-item">
      <button
        onClick={() => ctx.toggle(id)}
        aria-expanded={isExpanded}
        aria-controls={`accordion-panel-${id}`}
      >
        {title}
      </button>
      {isExpanded && (
        <div id={`accordion-panel-${id}`} role="region">
          {children}
        </div>
      )}
    </div>
  );
};
```

### 2.3 Custom Hooks

Encapsulate reusable stateful logic into hooks. Each hook has a single responsibility.

```tsx
// useDebounce — reusable debounce hook
function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}

// useMediaQuery — responsive behavior hook
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
```

---

## 3. Styling Architecture

### 3.1 Choosing an Approach

| Approach | Best For | Trade-offs |
|---|---|---|
| **CSS Modules** | Large apps, static styles | No dynamic styling at runtime |
| **CSS-in-JS** (styled-components, Emotion) | Themed / dynamic styles | Bundle size, runtime cost |
| **Tailwind CSS** | Rapid prototyping, consistent design systems | Verbose HTML, learning curve |
| **Plain CSS / BEM** | Simple sites, no build tooling | Manual scoping, global namespace |

### 3.2 Naming Conventions (BEM)

```css
/* Block — standalone component */
.card { }

/* Element — part of a block */
.card__title { }
.card__body { }

/* Modifier — a variant */
.card--featured { }
.card__title--large { }
```

**React component with BEM classes:**

```tsx
function Card({ featured, title, children }: CardProps) {
  const className = clsx('card', { 'card--featured': featured });

  return (
    <div className={className}>
      <h2 className="card__title">{title}</h2>
      <div className="card__body">{children}</div>
    </div>
  );
}
```

### 3.3 CSS Modules with TypeScript

```tsx
// Component.module.css
// .root { padding: 1rem; }
// .title { font-size: 1.25rem; color: var(--color-primary); }

import styles from './Component.module.css';

function Component() {
  return (
    <div className={styles.root}>
      <h2 className={styles.title}>Hello</h2>
    </div>
  );
}
```

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

## 6. State Management

### 6.1 Local vs Global State

| State Type | Examples | Where |
|---|---|---|
| **Local UI state** | Form inputs, toggles, modals | `useState`, `useReducer` in component |
| **Shared UI state** | Theme, sidebar open, locale | React Context, Zustand |
| **Server state** | API data, cache | React Query / SWR / TanStack Query |
| **URL state** | Search params, path, filters | `useSearchParams`, React Router |

**Rule of thumb:** Start with local state. Lift state up only when multiple children need it. Reach for a global store only when many unrelated components share the state.

### 6.2 Server State (React Query)

```tsx
// ✅ GOOD: Server state managed by React Query
function useProjects(page: number) {
  return useQuery({
    queryKey: ['projects', page],
    queryFn: () => fetch(`/api/projects?page=${page}`).then((r) => r.json()),
    staleTime: 5 * 60 * 1000, // 5 min before refetch
    gcTime: 30 * 60 * 1000,    // 30 min cache retention
  });
}

// Mutations with optimistic updates
function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (project: Project) => fetch(`/api/projects/${project.id}`, { method: 'PUT', body: JSON.stringify(project) }),
    onMutate: async (project) => {
      await queryClient.cancelQueries({ queryKey: ['projects'] });
      const previous = queryClient.getQueryData(['projects']);
      queryClient.setQueryData(['projects'], (old: Project[]) => old.map((p) => (p.id === project.id ? project : p)));
      return { previous };
    },
    onError: (_err, _project, context) => {
      queryClient.setQueryData(['projects'], context?.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['projects'] }),
  });
}
```

### 6.3 UI State (Zustand)

```tsx
import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface UIState {
  sidebarOpen: boolean;
  theme: 'light' | 'dark';
  toggleSidebar: () => void;
  setTheme: (theme: 'light' | 'dark') => void;
}

const useUIStore = create<UIState>()(
  devtools(
    (set) => ({
      sidebarOpen: false,
      theme: 'light',
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setTheme: (theme) => set({ theme }),
    }),
    { name: 'UIStore' }
  )
);
```

---

## 7. Form Handling

### 7.1 Controlled vs Uncontrolled

```tsx
// Controlled — React manages input state (preferred)
function ControlledForm() {
  const [email, setEmail] = useState('');

  return (
    <input
      type="email"
      value={email}
      onChange={(e) => setEmail(e.target.value)}
    />
  );
}

// Uncontrolled — DOM manages input state (use with refs)
function UncontrolledForm() {
  const emailRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    submitEmail(emailRef.current?.value ?? '');
  };

  return (
    <form onSubmit={handleSubmit}>
      <input type="email" ref={emailRef} defaultValue="" />
    </form>
  );
}
```

### 7.2 Form Validation with Zod + React Hook Form

```tsx
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';

const contactSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Enter a valid email address'),
  message: z.string().min(10, 'Message must be at least 10 characters').max(1000),
});

type ContactFormData = z.infer<typeof contactSchema>;

function ContactForm() {
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<ContactFormData>({
    resolver: zodResolver(contactSchema),
  });

  const onSubmit = async (data: ContactFormData) => {
    await submitContact(data);
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} noValidate>
      <FormField label="Name" error={errors.name?.message}>
        <input {...register('name')} aria-invalid={!!errors.name} />
      </FormField>

      <FormField label="Email" error={errors.email?.message}>
        <input type="email" {...register('email')} aria-invalid={!!errors.email} />
      </FormField>

      <FormField label="Message" error={errors.message?.message}>
        <textarea {...register('message')} aria-invalid={!!errors.message} />
      </FormField>

      <button type="submit" disabled={isSubmitting}>
        {isSubmitting ? 'Sending...' : 'Send'}
      </button>
    </form>
  );
}

// Reusable form field with error display
function FormField({ label, error, children }: FormFieldProps) {
  return (
    <div className="form-field">
      <label>{label}</label>
      {children}
      {error && (
        <p className="form-field__error" role="alert">
          {error}
        </p>
      )}
    </div>
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

### 10.1 Semantic HTML

```tsx
// ❌ BAD: Div soup
function Navigation() {
  return (
    <div className="nav">
      <div className="nav-item" onClick={handleClick}>Home</div>
      <div className="nav-item" onClick={handleClick}>About</div>
    </div>
  );
}

// ✅ GOOD: Semantic HTML
function Navigation() {
  return (
    <nav aria-label="Main navigation">
      <ul role="list">
        <li><a href="/">Home</a></li>
        <li><a href="/about">About</a></li>
      </ul>
    </nav>
  );
}
```

### 10.2 ARIA Attributes

```tsx
// Use ARIA only when semantic HTML is insufficient
function Toggle({ label, pressed, onToggle }: ToggleProps) {
  return (
    <button
      role="switch"
      aria-checked={pressed}
      aria-label={label}
      onClick={onToggle}
    >
      <span className="toggle-thumb" />
    </button>
  );
}

// Live region for dynamic content
function Toast({ message }: { message: string }) {
  return (
    <div role="status" aria-live="polite" aria-atomic="true" className="toast">
      {message}
    </div>
  );
}
```

### 10.3 Keyboard Navigation

```tsx
function MenuList({ items, onSelect }: MenuListProps) {
  const [focusedIndex, setFocusedIndex] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setFocusedIndex((prev) => (prev + 1) % items.length);
        break;
      case 'ArrowUp':
        e.preventDefault();
        setFocusedIndex((prev) => (prev - 1 + items.length) % items.length);
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        onSelect(items[focusedIndex]);
        break;
      case 'Escape':
        // Close menu
        break;
    }
  };

  return (
    <ul ref={listRef} role="menu" onKeyDown={handleKeyDown} tabIndex={0}>
      {items.map((item, i) => (
        <li
          key={item.id}
          role="menuitem"
          tabIndex={i === focusedIndex ? 0 : -1}
          aria-current={i === focusedIndex}
        >
          {item.label}
        </li>
      ))}
    </ul>
  );
}
```

### 10.4 Focus Management

```tsx
// Trap focus inside modals
function useFocusTrap(containerRef: RefObject<HTMLElement>, isActive: boolean) {
  useEffect(() => {
    if (!isActive || !containerRef.current) return;

    const container = containerRef.current;
    const focusable = container.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };

    first?.focus();
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [containerRef, isActive]);
}
```

### 10.5 Color Contrast

- **WCAG AA**: 4.5:1 for normal text, 3:1 for large text (≥18px bold or ≥24px).
- **WCAG AAA**: 7:1 for normal text, 4.5:1 for large text.
- Test with tools: axe DevTools, Lighthouse, Colour Contrast Analyser.
- Never convey information through color alone — use icons, text, or patterns as supplements.

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

```tsx
// Automate a11y checks in component tests
import { render } from '@testing-library/react';
import { axe, toHaveNoViolations } from 'jest-axe';

expect.extend(toHaveNoViolations);

it('has no accessibility violations', async () => {
  const { container } = render(<Navigation />);
  const results = await axe(container);
  expect(results).toHaveNoViolations();
});
```

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

---

## Workflow: Applying This Skill

When the Frontend Code Philosophy skill is loaded during code review, planning, or implementation:

1. **Analyze the context** — Identify which area of frontend code is being worked on (UI component, form, state, routing, styling, tests, etc.).

2. **Reference the relevant section** — Each section above provides concrete patterns, code examples, and anti-patterns. Consult the matching section directly.

3. **Evaluate against principles** — Check the code against the following prioritized checklist:
   - ✅ **Rendering purity** — Does the render method contain business logic?
   - ✅ **Component design** — Is the component too large? Should it be split via container/presentational or compound patterns?
   - ✅ **State management** — Is state correctly scoped (local vs shared vs server)?
   - ✅ **Accessibility** — Are semantic HTML and ARIA used correctly? Is it keyboard-navigable?
   - ✅ **Performance** — Are there unnecessary re-renders? Could memoization, virtualization, or code splitting help?
   - ✅ **Security** — Is user input sanitized? Are secrets exposed?
   - ✅ **Error handling** — Are error boundaries and fallback UIs in place?
   - ✅ **Forms** — Are validation patterns followed? Are error messages accessible?
   - ✅ **Tests** — Are there component and E2E tests covering critical flows?

4. **Propose improvements** — For each violation found, provide a code diff or refactored version following the patterns in this skill.

5. **Explain the rationale** — Briefly describe why the new implementation is superior (e.g., "extracting this to a hook makes the component testable and the data-fetching logic reusable").

6. **Verify** — After changes, ensure:
   - The app builds without errors (`tsc --noEmit`, `npm run build`)
   - Lint passes (`eslint`, `prettier --check`)
   - Tests pass (`vitest`, `playwright test`)
   - Lighthouse or axe audit shows no new accessibility or performance regressions
