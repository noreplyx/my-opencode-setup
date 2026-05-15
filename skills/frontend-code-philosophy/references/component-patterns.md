---
name: component-patterns
description: Presentation layer, component design patterns, styling architecture, state management, and form handling for frontend code.
---

## 1. Presentation Layer

### 1.1 Pure Rendering Functions

Rendering functions **must be pure** — they transform state/data into a visual representation and **must NOT contain business logic**. Business logic belongs in separate modules, services, or controller layers.

**Bad — business logic in the render function:**

```js
// ❌ BAD: Business logic mixed into rendering
function renderUserProfile(container, userId) {
  fetch(`/api/users/${userId}`)
    .then(r => r.json())
    .then(user => {
      // Business logic in the rendering path
      const fullName = `${user.firstName} ${user.lastName}`.toUpperCase();
      container.innerHTML = `<div>${fullName}</div>`;
    });
}
```

**Good — logic extracted to a service layer:**

```js
// ✅ GOOD: Pure rendering function
function renderUserProfile(container, user) {
  container.innerHTML = `
    <div class="user-profile">
      <img src="${escapeHtml(user.avatarUrl)}" alt="${escapeHtml(user.displayName)}" />
      <span class="user-name">${escapeHtml(user.displayName)}</span>
    </div>
  `;
}

// Service layer handles data fetching and business logic
async function loadUserProfile(container, userId) {
  container.innerHTML = `<div class="skeleton" aria-busy="true"></div>`;
  try {
    const user = await fetchUser(userId);
    if (!user) {
      renderNotFound(container);
      return;
    }
    renderUserProfile(container, user);
  } catch (err) {
    renderError(container, err);
  }
}
```

### 1.2 Skeleton / Shimmer Pattern

Improve perceived performance during loading states with skeleton screens. Never show a blank area or janky spinner without context.

```js
// Skeleton element — reusable base
function createSkeleton({ width = '100%', height = '1rem', borderRadius = '4px' } = {}) {
  const el = document.createElement('div');
  el.className = 'skeleton';
  el.style.cssText = `width:${width};height:${height};border-radius:${borderRadius};`;
  el.setAttribute('aria-hidden', 'true');
  return el;
}

// CSS (add to stylesheet)
// .skeleton {
//   background: linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%);
//   background-size: 200% 100%;
//   animation: shimmer 1.5s infinite;
// }
// @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }

// Usage in a page skeleton
function renderUserProfileSkeleton(container) {
  container.innerHTML = '';
  container.setAttribute('role', 'status');
  container.setAttribute('aria-label', 'Loading user profile');

  const avatar = createSkeleton({ width: '48px', height: '48px', borderRadius: '50%' });
  const nameLine = createSkeleton({ width: '60%', height: '1.5rem' });
  const detailLine = createSkeleton({ width: '40%', height: '1rem' });

  container.append(avatar, nameLine, detailLine);

  const srOnly = document.createElement('span');
  srOnly.className = 'sr-only';
  srOnly.textContent = 'Loading...';
  container.appendChild(srOnly);
}
```

---

## 2. Component Design Patterns

### 2.1 Container / Presentational Pattern

Separate data orchestration (container) from rendering (presentational). Containers know about data sources and side effects; presentational functions receive data via arguments and are highly reusable.

```js
// Presentational — pure, reusable, testable
function renderUserList(container, { users, onSelect, isLoading }) {
  if (isLoading) {
    renderUserListSkeleton(container);
    return;
  }
  if (users.length === 0) {
    renderEmptyState(container, { message: 'No users found' });
    return;
  }

  const list = document.createElement('ul');
  list.setAttribute('role', 'list');

  users.forEach(user => {
    const item = document.createElement('li');
    const btn = document.createElement('button');
    btn.textContent = user.name;
    btn.addEventListener('click', () => onSelect(user));
    item.appendChild(btn);
    list.appendChild(item);
  });

  container.innerHTML = '';
  container.appendChild(list);
}

// Container — data-aware, orchestrates side effects
async function UserListPageController(container) {
  const { data: users, isLoading } = await fetchUsers();

  renderUserList(container, {
    users: users ?? [],
    isLoading,
    onSelect: (user) => {
      trackEvent('user_selected', { userId: user.id });
      navigateTo(`/users/${user.id}`);
    },
  });
}
```

### 2.2 Composition via Event-Based Communication

Components communicate via events and callbacks, avoiding tight coupling.

```js
// Accordion pattern using event delegation and data attributes

function createAccordion(container, items) {
  container.className = 'accordion';

  items.forEach((item, index) => {
    const section = document.createElement('div');
    section.className = 'accordion-item';

    const header = document.createElement('button');
    header.className = 'accordion-header';
    header.textContent = item.title;
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('aria-controls', `accordion-panel-${index}`);
    header.dataset.accordionId = index;

    const panel = document.createElement('div');
    panel.id = `accordion-panel-${index}`;
    panel.className = 'accordion-panel';
    panel.setAttribute('role', 'region');
    panel.hidden = true;
    panel.innerHTML = item.content;

    header.addEventListener('click', () => {
      const isExpanded = header.getAttribute('aria-expanded') === 'true';
      // Close all panels
      container.querySelectorAll('.accordion-header').forEach(h =>
        h.setAttribute('aria-expanded', 'false')
      );
      container.querySelectorAll('.accordion-panel').forEach(p =>
        p.hidden = true
      );
      // Open this panel
      if (!isExpanded) {
        header.setAttribute('aria-expanded', 'true');
        panel.hidden = false;
      }
    });

    section.appendChild(header);
    section.appendChild(panel);
    container.appendChild(section);
  });
}
```

### 2.3 Reusable Stateful Logic (Module Pattern)

Encapsulate reusable stateful logic into modules or classes. Each module has a single responsibility.

```js
// Debounce — reusable debounce function (framework-agnostic)
function createDebounce(delayMs) {
  let timer = null;
  return {
    call(fn) {
      clearTimeout(timer);
      timer = setTimeout(fn, delayMs);
    },
    cancel() {
      clearTimeout(timer);
    },
  };
}

// MediaQuery — reactive media query observer
function createMediaQuery(query) {
  const mql = window.matchMedia(query);
  return {
    matches: mql.matches,
    onChange(callback) {
      mql.addEventListener('change', (e) => callback(e.matches));
      return () => mql.removeEventListener('change', callback);
    },
  };
}

// Usage
const debouncer = createDebounce(300);
searchInput.addEventListener('input', () => {
  debouncer.call(() => performSearch(searchInput.value));
});
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

**Component with BEM classes:**

```js
function renderCard(container, { featured, title, content }) {
  const className = ['card', featured && 'card--featured'].filter(Boolean).join(' ');
  container.innerHTML = `
    <div class="${className}">
      <h2 class="card__title">${escapeHtml(title)}</h2>
      <div class="card__body">${escapeHtml(content)}</div>
    </div>
  `;
}
```

### 3.3 CSS Modules with Build Tools

When using a bundler that supports CSS Modules:

```css
/* Component.module.css */
.root { padding: 1rem; }
.title { font-size: 1.25rem; color: var(--color-primary); }
```

```js
import styles from './Component.module.css';

function renderComponent(container) {
  container.innerHTML = `
    <div class="${styles.root}">
      <h2 class="${styles.title}">Hello</h2>
    </div>
  `;
}
```

---

## 4. State Management

### 4.1 Local vs Global State

| State Type | Examples | Where |
|---|---|---|
| **Local UI state** | Form inputs, toggles, modals | Local variables, closures, class fields |
| **Shared UI state** | Theme, sidebar open, locale | Events, reactive stores (e.g. Zustand, RxJS), singleton modules |
| **Server state** | API data, cache | Dedicated data layer with caching (e.g. TanStack Query, SWR, manual cache) |
| **URL state** | Search params, path, filters | `URLSearchParams`, `History API`, hash |

**Rule of thumb:** Start with local state (closures/variables). Lift state up only when multiple children need it. Reach for a global store only when many unrelated parts of the UI share the state.

### 4.2 Server State (Caching Data Layer)

```js
// Simple cache wrapper for server state
function createQueryCache() {
  const cache = new Map();
  const listeners = new Map();

  return {
    async query(key, fetcher, staleTime = 5 * 60 * 1000) {
      const cached = cache.get(key);
      if (cached && Date.now() - cached.timestamp < staleTime) {
        return cached.data;
      }
      const data = await fetcher();
      cache.set(key, { data, timestamp: Date.now() });
      this.notify(key, data);
      return data;
    },
    invalidate(key) {
      cache.delete(key);
      this.notify(key, null);
    },
    subscribe(key, listener) {
      if (!listeners.has(key)) listeners.set(key, new Set());
      listeners.get(key).add(listener);
      return () => listeners.get(key)?.delete(listener);
    },
    notify(key, data) {
      listeners.get(key)?.forEach(fn => fn(data));
    },
  };
}

const queryCache = createQueryCache();

// Optimistic update pattern
async function updateProject(project) {
  const previous = queryCache.getQueryData(['projects']);
  // Optimistically update UI
  queryCache.setQueryData(['projects'], (old) =>
    old.map(p => p.id === project.id ? project : p)
  );
  try {
    await fetch(`/api/projects/${project.id}`, {
      method: 'PUT',
      body: JSON.stringify(project),
    });
  } catch (err) {
    // Rollback on error
    queryCache.setQueryData(['projects'], previous);
    throw err;
  }
}
```

### 4.3 Shared UI State (Event-Based Store)

```js
// Minimal observable store for shared UI state
function createStore(initialState) {
  let state = { ...initialState };
  const listeners = new Set();

  return {
    getState() { return state; },
    setState(partial) {
      state = { ...state, ...partial };
      listeners.forEach(fn => fn(state));
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

// Usage
const uiStore = createStore({ sidebarOpen: false, theme: 'light' });

uiStore.subscribe((state) => {
  document.documentElement.dataset.theme = state.theme;
});

// Toggle sidebar
uiStore.setState({ sidebarOpen: !uiStore.getState().sidebarOpen });
```

---

## 5. Form Handling

### 5.1 Controlled vs Uncontrolled Inputs

```js
// Controlled — JavaScript manages input state (preferred)
function createControlledForm(container) {
  let email = '';

  const input = document.createElement('input');
  input.type = 'email';
  input.value = email;
  input.addEventListener('input', (e) => { email = e.target.value; });

  container.appendChild(input);
}

// Uncontrolled — DOM manages input state (use on submit)
function createUncontrolledForm(container) {
  const form = document.createElement('form');
  form.innerHTML = `
    <input type="email" name="email" />
    <button type="submit">Submit</button>
  `;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const data = new FormData(form);
    submitEmail(data.get('email'));
  });
  container.appendChild(form);
}
```

### 5.2 Form Validation with Zod

```js
import { z } from 'zod';

const contactSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters'),
  email: z.string().email('Enter a valid email address'),
  message: z.string().min(10, 'Message must be at least 10 characters').max(1000),
});

function renderContactForm(container, { onSubmit }) {
  container.innerHTML = `
    <form id="contact-form" novalidate>
      <div class="form-field">
        <label for="name">Name</label>
        <input type="text" id="name" name="name" aria-invalid="false" />
        <p class="form-field__error" role="alert" hidden></p>
      </div>
      <div class="form-field">
        <label for="email">Email</label>
        <input type="email" id="email" name="email" aria-invalid="false" />
        <p class="form-field__error" role="alert" hidden></p>
      </div>
      <div class="form-field">
        <label for="message">Message</label>
        <textarea id="message" name="message" aria-invalid="false"></textarea>
        <p class="form-field__error" role="alert" hidden></p>
      </div>
      <button type="submit" id="submit-btn">Send</button>
    </form>
  `;

  const form = container.querySelector('#contact-form');
  const submitBtn = container.querySelector('#submit-btn');

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form));
    const result = contactSchema.safeParse(data);

    // Clear previous errors
    container.querySelectorAll('.form-field__error').forEach(el => {
      el.hidden = true;
      el.textContent = '';
    });
    container.querySelectorAll('[aria-invalid]').forEach(el => {
      el.setAttribute('aria-invalid', 'false');
    });

    if (!result.success) {
      result.error.issues.forEach(issue => {
        const field = form.querySelector(`[name="${issue.path[0]}"]`);
        const errorEl = field?.closest('.form-field')?.querySelector('.form-field__error');
        if (field) field.setAttribute('aria-invalid', 'true');
        if (errorEl) {
          errorEl.textContent = issue.message;
          errorEl.hidden = false;
        }
      });
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';
    try {
      await onSubmit(result.data);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send';
    }
  });
}
```