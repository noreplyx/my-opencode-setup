---
name: quality-and-testing
description: Detailed reference for security, performance, logging, error handling, refactoring, and testing patterns.
---

### 5. Security

#### Input Validation

```typescript
import { z } from 'zod';  // schema validation library

const CreateUserSchema = z.object({
  email: z.string().email('Invalid email format'),
  age: z.number().int().min(0).max(150),
  role: z.enum(['admin', 'user', 'viewer']),
});

function validateUserInput(raw: unknown): CreateUserInput {
  const result = CreateUserSchema.safeParse(raw);
  if (!result.success) {
    throw new ValidationError(result.error.flatten().fieldErrors);
  }
  return result.data;
}
```

#### Environment Variables (Avoid Secrets in Code)

```typescript
// config/env.ts
import 'dotenv/config';

function requireEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key}`);
  return value;
}

export const config = {
  db: {
    url: requireEnv('DATABASE_URL'),
    poolSize: Number(process.env.DB_POOL_SIZE) || 10,
  },
  jwt: {
    secret: requireEnv('JWT_SECRET'),
    expiresIn: process.env.JWT_EXPIRES_IN || '1h',
  },
  log: {
    level: process.env.LOG_LEVEL || 'info',
  },
} as const;
```

#### SQL Injection Prevention

**❌ Vulnerable — string interpolation:**
```typescript
const query = `SELECT * FROM users WHERE email = '${userInput}'`;
await db.execute(query);
```

**✅ Safe — parameterized queries (Prisma / Knex / pg):**
```typescript
// Prisma (safe by default):
await prisma.user.findUnique({ where: { email: userInput } });

// Raw with parameterized:
await db.execute('SELECT * FROM users WHERE email = $1', [userInput]);
```

### 6. Performance

#### Big O Notation — Prefer Optimal Complexity

```typescript
// ❌ O(n²) — nested loop
function findDuplicates(arr: number[]): number[] {
  const dups: number[] = [];
  for (let i = 0; i < arr.length; i++) {
    for (let j = i + 1; j < arr.length; j++) {
      if (arr[i] === arr[j] && !dups.includes(arr[i])) dups.push(arr[i]);
    }
  }
  return dups;
}

// ✅ O(n) — using a Set
function findDuplicates(arr: number[]): number[] {
  const seen = new Set<number>();
  const dups = new Set<number>();
  for (const n of arr) {
    if (seen.has(n)) dups.add(n);
    else seen.add(n);
  }
  return [...dups];
}
```

#### Lazy Loading Pattern

```typescript
class HeavyService {
  private constructor() { /* expensive initialization */ }

  private static instance: HeavyService | null = null;

  static getInstance(): HeavyService {
    if (!this.instance) {
      this.instance = new HeavyService(); // initialized only on first use
    }
    return this.instance;
  }
}

// Or with a lazy async initializer:
class ExpensiveReportGenerator {
  private dataPromise: Promise<ReportData> | null = null;

  async generate(): Promise<Report> {
    if (!this.dataPromise) {
      this.dataPromise = this.fetchData(); // fetched once, cached
    }
    const data = await this.dataPromise;
    return this.buildReport(data);
  }

  private async fetchData(): Promise<ReportData> { /* ... */ }
  private buildReport(data: ReportData): Report { /* ... */ }
}
```

#### Connection Pooling

```typescript
// ❌ Open/close on every request:
app.get('/users', async (req, res) => {
  const client = new pg.Client(connectionString);
  await client.connect();
  const result = await client.query('SELECT * FROM users');
  await client.end(); // expensive overhead per request
  res.json(result.rows);
});

// ✅ Reuse pool:
const pool = new pg.Pool({ connectionString, max: 20, idleTimeoutMillis: 30000 });

app.get('/users', async (req, res) => {
  const result = await pool.query('SELECT * FROM users');
  res.json(result.rows);
});
```

### 7. Logging & Telemetry

#### Structured Logging JSON Example

```typescript
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

```typescript
import { randomUUID } from 'crypto';
import { AsyncLocalStorage } from 'async_hooks';

const asyncContext = new AsyncLocalStorage<{ correlationId: string }>();

// Middleware — generates and stores correlation ID per request
function correlationMiddleware(req: Request, res: Response, next: NextFunction): void {
  const correlationId = (req.headers['x-correlation-id'] as string) || randomUUID();
  res.setHeader('x-correlation-id', correlationId);
  asyncContext.run({ correlationId }, () => next());
}

// Logger — automatically attaches correlation ID
function createLogger() {
  const store = () => asyncContext.getStore();
  return {
    info: (msg: string, meta?: Record<string, unknown>) => {
      console.log(JSON.stringify({
        level: 'info',
        message: msg,
        ...meta,
        correlationId: store()?.correlationId || 'none',
        timestamp: new Date().toISOString(),
      }));
    },
    error: (msg: string, err?: Error, meta?: Record<string, unknown>) => {
      console.error(JSON.stringify({
        level: 'error',
        message: msg,
        error: { name: err?.name, message: err?.message, stack: err?.stack },
        ...meta,
        correlationId: store()?.correlationId || 'none',
        timestamp: new Date().toISOString(),
      }));
    },
  };
}
```

### 8. Error Handling Patterns

#### Custom Error Classes

```typescript
export class AppError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number = 500,
    public readonly code: string = 'INTERNAL_ERROR',
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id?: string) {
    super(
      id ? `${resource} with id '${id}' not found` : `${resource} not found`,
      404,
      'NOT_FOUND'
    );
  }
}

export class ValidationError extends AppError {
  constructor(errors: Record<string, string[]>) {
    super('Validation failed', 400, 'VALIDATION_ERROR', { errors });
  }
}

// Usage:
throw new NotFoundError('User', userId);
```

#### Error Boundary Pattern (Frontend)

```typescript
interface ErrorBoundaryProps {
  fallback?: React.ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    logger.error('React component crashed', error, { componentStack: errorInfo.componentStack });
    this.props.onError?.(error, errorInfo);
  }

  render(): React.ReactNode {
    if (this.state.hasError) {
      return this.props.fallback ?? <DefaultFallback error={this.state.error} />;
    }
    return this.props.children;
  }
}
```

#### Graceful Degradation

```typescript
async function fetchUserProfile(userId: string): Promise<UserProfile> {
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

```typescript
// BEFORE:
function processOrder(order: Order): Receipt {
  if (order.items.length === 0) throw new Error('Empty order');
  const subtotal = order.items.reduce((sum, item) => sum + item.price * item.qty, 0);
  const tax = subtotal * 0.08;
  const discount = order.coupon ? subtotal * 0.1 : 0;
  const total = subtotal + tax - discount;
  if (total < 0) throw new Error('Negative total');
  return { items: order.items, subtotal, tax, discount, total, date: new Date() };
}

// AFTER:
function processOrder(order: Order): Receipt {
  assertNonEmpty(order.items);
  const subtotal = calculateSubtotal(order.items);
  const tax = calculateTax(subtotal);
  const discount = calculateDiscount(subtotal, order.coupon);
  const total = calculateTotal(subtotal, tax, discount);
  assertPositive(total);
  return buildReceipt(order.items, subtotal, tax, discount, total);
}

function assertNonEmpty(items: Item[]): void { /* ... */ }
function calculateSubtotal(items: Item[]): number { /* ... */ }
function calculateTax(subtotal: number): number { /* ... */ }
function calculateDiscount(subtotal: number, coupon?: Coupon): number { /* ... */ }
function calculateTotal(subtotal: number, tax: number, discount: number): number { /* ... */ }
function assertPositive(total: number): void { /* ... */ }
function buildReceipt(items: Item[], subtotal: number, tax: number, discount: number, total: number): Receipt { /* ... */ }
```

#### Replace Conditionals with Polymorphism

```typescript
// BEFORE:
function calculateShipping(order: Order): number {
  switch (order.shippingType) {
    case 'standard': return order.weight * 0.5;
    case 'express': return order.weight * 1.5 + 5;
    case 'overnight': return order.weight * 3.0 + 10;
    default: throw new Error(`Unknown type: ${order.shippingType}`);
  }
}

// AFTER:
interface ShippingCalculator {
  calculate(weight: number): number;
}

class StandardShipping implements ShippingCalculator {
  calculate(weight: number): number { return weight * 0.5; }
}

class ExpressShipping implements ShippingCalculator {
  calculate(weight: number): number { return weight * 1.5 + 5; }
}

class OvernightShipping implements ShippingCalculator {
  calculate(weight: number): number { return weight * 3.0 + 10; }
}
```

#### Extract Parameter Object

```typescript
// BEFORE:
function createUser(name: string, email: string, age: number, role: string, isActive: boolean): User {
  // ...
}

createUser('Alice', 'alice@example.com', 30, 'admin', true); // hard to read

// AFTER:
interface CreateUserParams {
  name: string;
  email: string;
  age: number;
  role: 'admin' | 'user';
  isActive: boolean;
}

function createUser(params: CreateUserParams): User {
  // ...
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

```typescript
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

```typescript
// In-memory implementation for tests:
class InMemoryOrderRepository implements OrderRepository {
  private orders: Order[] = [];

  async save(order: Order): Promise<void> {
    this.orders.push(order);
  }

  async findById(id: string): Promise<Order | null> {
    return this.orders.find(o => o.id === id) ?? null;
  }

  // Helper for test assertions:
  findAll(): Order[] {
    return [...this.orders];
  }
}
```

#### Mocking Strategies

```typescript
// 1. Interface-based mocks (preferred — no framework needed):
const mockRepo: OrderRepository = {
  save: vi.fn().mockResolvedValue(undefined),
  findById: vi.fn().mockResolvedValue(null),
};

// 2. Partial real implementations:
class FakePaymentGateway implements PaymentGateway {
  async charge(amount: number, token: string): Promise<PaymentResult> {
    if (token === 'fail_me') throw new PaymentError('Card declined');
    return { id: `ch_${Date.now()}`, amount, status: 'succeeded' };
  }
}

// 3. Spy on side effects:
const emailSpy = vi.spyOn(emailService, 'sendWelcome');
await useCase.execute(input);
expect(emailSpy).toHaveBeenCalledWith('user@example.com', 'Welcome!');
```
