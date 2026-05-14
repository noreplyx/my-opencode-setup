---
name: component-patterns
description: Presentation layer, component design patterns, styling architecture, state management, and form handling for frontend code.
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
