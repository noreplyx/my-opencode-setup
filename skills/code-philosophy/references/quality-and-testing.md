---
name: quality-and-testing
description: Detailed reference for security, performance, logging, error handling, refactoring, and testing patterns.
---

### 5. Security

#### Input Validation

```js
// Using a schema validation library (e.g. Zod, Joi, Valibot)

const CreateUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  age: z.number().int().min(0).max(150),
  role: z.enum(['admin', 'user', 'viewer']),
});

function validateUserInput(raw) {
  const result = CreateUserSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(result.error.flatten().fieldErrors);
  }
  return result.data;
}
```

#### Environment Variables (Avoid Secrets in Code)

```js
// config/env.js

function requireEnv(key) {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

const config = {
  db: {
    url: requireEnv('DATABASE_URL'),
    poolSize: Number(process.env.DB_POOL_SIZE) || 10,
  },
  auth: {
    secret: requireEnv('AUTH_SECRET'),
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
};
```

#### SQL Injection Prevention

**❌ Vulnerable — string interpolation:**
```js
const query = `SELECT * FROM users WHERE email = '${userInput}'`;
await db.execute(query);
```

**✅ Safe — parameterized queries:**
```js
// Using an ORM (safe by default):
await db.users.findUnique({ where: { email: userInput } });

// Raw with parameterized:
await db.execute('SELECT * FROM users WHERE email = $1', [userInput]);
```

### 6. Performance

#### Big O Notation — Prefer Optimal Complexity

```js
// ❌ O(n²) — nested loop
function findDuplicates(arr) {
  const dups = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] === arr[j] && !dups.includes(arr[i])) dups.push(arr[i]);
    }
  }
  return dups;
}

// ✅ O(n) — using a Set
function findDuplicates(arr) {
  const seen = new Set();
  const dups = new Set();
  for (const n of arr) {
    if (seen.has(n)) dups.add(n);
    else seen.add(n);
  }
  return [...dups];
}
```

#### Lazy Loading Pattern

```js
class HeavyService {
  constructor() { /* expensive initialization */ }

  static getInstance() {
    if (!this.instance) {
      this.instance = new HeavyService(); // initialized only on first use
    }
    return this.instance;
  }
}

// Or with a lazy async initializer:
class ExpensiveReportGenerator {
  constructor() {
    this.dataPromise = null;
  }

  async generate() {
    if (!this.dataPromise) {
      this.dataPromise = this.fetchData(); // fetched once, cached
    }
    const data = await this.dataPromise;
    return this.buildReport(data);
  }

  async fetchData() { /* ... */ }
  buildReport(data) { /* ... */ }
}
```

#### Connection Pooling

```js
// ❌ Open/close on every request:
async function getUsers() {
  const client = await createDbConnection(connectionString);
  const result = await client.query('SELECT * FROM users');
  await client.close(); // expensive overhead per request
  return result.rows;
}

// ✅ Reuse pool:
const pool = createDbPool({ connectionString, max: 20 });
async function getUsers() {
  const result = await pool.query('SELECT * FROM users');
  return result.rows;
}
```

### 7. Logging & Telemetry

#### Structured Logging JSON Example

```js
// ❌ Unstructured:
console.log(`User ${userId} placed order ${orderId} for $${total}`);

// ✅ Structured:
logger.info({
  message: 'Order placed successfully',
  event: 'order.placed',
  userId,
  orderId,
  total: 123.45,
  currency: 'USD',
  itemsCount: 3,
  durationMs: Date.now() - start,
});

// Produces: {"level":"info","message":"Order placed successfully","event":"order.placed","userId":"usr_123","orderId":"ord_456","total":123.45,"currency":"USD","itemsCount":3,"durationMs":42,"timestamp":"2026-05-07T10:30:00.000Z"}
```

#### Correlation ID Pattern

```js
const { randomUUID } = await import('crypto');

// Request context — stores correlation ID per request
const requestContext = {
  _store: new Map(),
  run(correlationId, fn) {
    this._store.set('correlationId', correlationId);
    try { return fn(); } finally { this._store.delete('correlationId'); }
  },
  getCorrelationId() { return this._store.get('correlationId') || 'none'; },
};

// Middleware — generates and stores correlation ID per request
function correlationMiddleware(request) {
  const correlationId = request.headers['x-correlation-id'] || generateId();
  requestContext.run(correlationId, () => {});
  return correlationId;
}

// Logger — automatically attaches correlation ID
function createLogger() {
  return {
    info(msg, meta) {
      console.log(JSON.stringify({
        level: 'info',
        message: msg,
        ...meta,
        correlationId: requestContext.getCorrelationId(),
        timestamp: new Date().toISOString(),
      }));
    },
    error(msg, err, meta) {
      console.error(JSON.stringify({
        level: 'error',
        message: msg,
        error: err ? { name: err.name, message: err.message } : undefined,
        ...meta,
        correlationId: requestContext.getCorrelationId(),
        timestamp: new Date().toISOString(),
      }));
    },
  };
}
```

### 8. Error Handling Patterns

#### Custom Error Classes

```js
class AppError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

class NotFoundError extends AppError {
  constructor(resource, id) {
    super(
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
      404,
      'NOT_FOUND'
    );
  }
}

class ValidationError extends AppError {
  constructor(errors) {
    super('Validation failed', 400, 'VALIDATION_ERROR', { errors });
  }
}

// Usage:
throw new NotFoundError('User', userId);
```

#### Error Boundary Pattern (UI)

```js
// Wrap render operations to catch and display errors gracefully
function withErrorBoundary(renderFn, fallbackFn) {
  return function (...args) {
    try {
      return renderFn(...args);
    } catch (error) {
      logger.error('UI component crashed', error);
      if (fallbackFn) return fallbackFn(error);
      return `<div role="alert">Something went wrong. Please try again.</div>`;
    }
  };
}
```

#### Graceful Degradation

```js
async function fetchUserProfile(userId) {
  try {
    return await userService.getProfile(userId);
  } catch (error) {
    logger.warn('Failed to fetch full profile, returning cached data', { userId, error });
    // Degrade gracefully: return cached data instead of crashing
    const cached = await cacheService.get(`profile:${userId}`);
    if (cached) return cached;

    // Return a minimal profile rather than failing entirely
    return {
      id: userId,
      name: 'Unknown',
      isDegraded: true,
    };
  }
}
```

### 9. Code Review Checklist

Use this checklist when reviewing pull requests or planning new code:

- [ ] **Single Responsibility**: Does each class/function do exactly one thing?
- [ ] **Open/Closed**: Can new behavior be added without modifying existing code?
- [ ] **Liskov Substitution**: Can subtypes replace their parent types without breaking?
- [ ] **Interface Segregation**: Are interfaces minimal and focused?
- [ ] **Dependency Inversion**: Do modules depend on abstractions, not concretions?
- [ ] **Meaningful Names**: Do names reveal intent without needing comments?
- [ ] **Small Functions**: Is every function under ~20 lines and doing one thing?
- [ ] **No Side Effects**: Are functions pure where possible?
- [ ] **DRY**: Is there duplicated logic that should be extracted?
- [ ] **KISS**: Is the simplest solution used? No patterns-for-the-sake-of-patterns?
- [ ] **YAGNI**: Is every feature justified by current requirements, not hypothetical futures?
- [ ] **Security**: Is all external input validated? Are secrets in env vars, not code?
- [ ] **SQL Injection**: Are all database queries parameterized?
- [ ] **Performance**: Is the algorithm/query optimal? Could it be O(n²) when O(n) is possible?
- [ ] **Error Handling**: Are errors caught, logged with context, and handled gracefully?
- [ ] **Logging**: Are structured logs used with correlation IDs for traceability?
- [ ] **Tests**: Is the code testable (dependency injection)? Are edge cases covered?
- [ ] **Clean Architecture**: Do dependencies point inward? Is the core framework-agnostic?

### 10. Refactoring Guide

#### Extract Method — Pull logic into named functions

```js
// BEFORE:
function processOrder(order) {
  if (order.items.length === 0) throw new Error('Empty order');
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const tax = subtotal * 0.08;
  const discount = order.coupon ? subtotal * 0.1 : 0;
  const total = subtotal + tax - discount;
  if (total < 0) throw new Error('Negative total');
  return { items: order.items, subtotal, tax, discount, total, date: new Date() };
}

// AFTER:
function processOrder(order) {
  assertNonEmpty(order.items);
  const subtotal = calculateSubtotal(order.items);
  const tax = calculateTax(subtotal);
  const discount = calculateDiscount(subtotal, order.coupon);
  const total = calculateTotal(subtotal, tax, discount);
  assertPositive(total);
  return buildReceipt(order.items, subtotal, tax, discount, total);
}

function assertNonEmpty(items) { /* ... */ }
function calculateSubtotal(items) { /* ... */ }
function calculateTax(subtotal) { /* ... */ }
function calculateDiscount(subtotal, coupon) { /* ... */ }
function calculateTotal(subtotal, tax, discount) { /* ... */ }
function assertPositive(total) { /* ... */ }
function buildReceipt(items, subtotal, tax, discount, total) { /* ... */ }
```

#### Replace Conditionals with Polymorphism

```js
// BEFORE:
function calculateShipping(order) {
  switch (order.shippingType) {
    case 'standard': return order.weight * 0.5;
    case 'express': return order.weight * 1.5 + 5;
    case 'overnight': return order.weight * 3.0 + 10;
    default: throw new Error(`Unknown type: ${order.shippingType}`);
  }
}

// AFTER:
// ShippingCalculator contract: { calculate(weight) }

class StandardShipping {
  calculate(weight) { return weight * 0.5; }
}

class ExpressShipping {
  calculate(weight) { return weight * 1.5 + 5; }
}

class OvernightShipping {
  calculate(weight) { return weight * 3.0 + 10; }
}
```

#### Extract Parameter Object

```js
// BEFORE:
function createUser(name, email, age, role, isActive) {
  // ...
}

createUser('Alice', 'alice@example.com', 30, 'admin', true); // hard to read

// AFTER:
function createUser(params) {
  // params: { name, email, age, role, isActive }
}

createUser({
  name: 'Alice',
  email: 'alice@example.com',
  age: 30,
  role: 'admin',
  isActive: true,
}); // self-documenting call site
```

### 11. Testing Philosophy

#### Unit Testing Principles

- **Test behavior, not implementation**: Assert on outputs/state, not on internal calls.
- **One assertion concept per test**: Each test should verify one logical behavior.
- **Arrange-Act-Assert**: Structure every test into three clear phases.

```js
describe('OrderService', () => {
  describe('placeOrder', () => {
    it('should calculate total including tax and discount', async () => {
      // Arrange
      const orderRepo = new InMemoryOrderRepository();
      const discountService = new FixedDiscountService(10);
      const service = new OrderService(orderRepo, discountService);
      const input = { userId: 'usr_1', items: [{ productId: 'p1', price: 100, qty: 2 }] };

      // Act
      const order = await service.placeOrder(input);

      // Assert
      expect(order.subtotal).toBe(200);
      expect(order.discount).toBe(20);   // 10% of 200
      expect(order.tax).toBe(16);         // 8% of (200 - 20)
      expect(order.total).toBe(196);      // 200 + 16 - 20
    });

    it('should throw when inventory is insufficient', async () => {
      const orderRepo = new InMemoryOrderRepository();
      const inventoryService = new InsufficientInventoryService();
      const service = new OrderService(orderRepo, inventoryService);

      await expect(service.placeOrder(mockInput))
        .rejects
        .toThrow(InventoryError);
    });
  });
});
```

#### Testability — Dependency Injection Enables Testing

```js
// In-memory implementation for tests:
class InMemoryOrderRepository {
  constructor() {
    this.orders = [];
  }

  async save(order) {
    this.orders.push(order);
  }

  async findById(id) {
    return this.orders.find(o => o.id === id) ?? null;
  }

  // Helper for test assertions:
  findAll() {
    return [...this.orders];
  }
}
```

#### Mocking Strategies

```js
// 1. Interface-based mocks (preferred — no framework needed):
const mockRepo = {
  save: jest.fn().mockResolvedValue(undefined),
  findById: jest.fn().mockResolvedValue(null),
};

// 2. Partial real implementations:
class FakePaymentGateway {
  async charge(amount, token) {
    if (token === 'fail_me') throw new PaymentError('Card declined');
    return { id: `ch_${Date.now()}`, amount, status: 'succeeded' };
  }
}

// 3. Spy on side effects:
const emailSpy = jest.spyOn(emailService, 'sendWelcome');
await useCase.execute(input);
expect(emailSpy).toHaveBeenCalledWith('user@example.com', 'Welcome!');
```
