---
name: code-philosophy
description: alway use this skill when planning or implementing code both frontend and backend to ensure adherence to clean code, clean architecture, SOLID principles, best practices, security, performance, logging (telemetry), and readability.
---

# Code Philosophy Skill

An expert in software craftsmanship with a deep commitment to creating maintainable, scalable, and high-quality software. This guide provides practical code examples for every principle to help you apply timeless engineering principles to your code.

## Core Principles

### 1. SOLID Principles

#### S — Single Responsibility
A class or function should have one, and only one, reason to change.

**❌ Violation:**
```typescript
class UserService {
  async createUser(data: UserInput): Promise<User> {
    const hashed = await bcrypt.hash(data.password, 10);
    const user = await db.users.create({ ...data, password: hashed });
    await emailClient.sendWelcome(user.email, user.name);
    logger.info(`User created: ${user.id}`);
    return user;
  }
}
```

**✅ Fix — Extract responsibilities:**
```typescript
class UserCreator {
  constructor(private repo: UserRepository, private hasher: PasswordHasher) {}
  async execute(data: UserInput): Promise<User> {
    const hashed = await this.hasher.hash(data.password);
    return this.repo.save({ ...data, password: hashed });
  }
}

class WelcomeEmailSender {
  constructor(private mailer: EmailClient) {}
  async sendWelcome(user: User): Promise<void> {
    await this.mailer.send(user.email, 'Welcome', `Hi ${user.name}!`);
  }
}
```

#### O — Open/Closed
Software entities should be open for extension but closed for modification.

**❌ Violation:**
```typescript
function getDiscount(price: number, customerType: string): number {
  if (customerType === 'regular') return price * 0.05;
  if (customerType === 'premium') return price * 0.10;
  if (customerType === 'vip') return price * 0.20; // ← modifies existing function
  return 0;
}
```

**✅ Fix — Extend via strategy:**
```typescript
interface DiscountStrategy {
  apply(price: number): number;
}

class RegularDiscount implements DiscountStrategy {
  apply(price: number): number { return price * 0.05; }
}

class PremiumDiscount implements DiscountStrategy {
  apply(price: number): number { return price * 0.10; }
}

// New types added via NEW classes, not by modifying existing code
class VipDiscount implements DiscountStrategy {
  apply(price: number): number { return price * 0.20; }
}
```

#### L — Liskov Substitution
Objects of a superclass should be replaceable with objects of its subclasses without breaking the application.

**❌ Violation:**
```typescript
class Rectangle {
  constructor(protected w: number, protected h: number) {}
  setWidth(w: number): void { this.w = w; }
  setHeight(h: number): void { this.h = h; }
  getArea(): number { return this.w * this.h; }
}

class Square extends Rectangle {
  setWidth(w: number): void { this.w = w; this.h = w; } // breaks LSP
  setHeight(h: number): void { this.h = h; this.w = h; }
}

function resize(rect: Rectangle): void {
  rect.setWidth(5);
  rect.setHeight(10);
  console.log(rect.getArea()); // Rectangle: 50, Square: 100 ← wrong!
}
```

**✅ Fix — Favor composition or a shared abstraction:**
```typescript
interface Shape {
  getArea(): number;
}

class RectangleV2 implements Shape {
  constructor(private w: number, private h: number) {}
  getArea(): number { return this.w * this.h; }
}

class SquareV2 implements Shape {
  constructor(private side: number) {}
  getArea(): number { return this.side * this.side; }
}
```

#### I — Interface Segregation
No client should be forced to depend on methods it does not use.

**❌ Violation:**
```typescript
interface Worker {
  work(): void;
  eat(): void;
  sleep(): void;
}

class Robot implements Worker {
  work(): void { /* ok */ }
  eat(): void { throw new Error('Robots do not eat'); }  // forced dependency
  sleep(): void { throw new Error('Robots do not sleep'); }
}
```

**✅ Fix — Segregated interfaces:**
```typescript
interface Workable { work(): void; }
interface Eatable { eat(): void; }
interface Sleepable { sleep(): void; }

class HumanWorker implements Workable, Eatable, Sleepable {
  work(): void { /* ... */ }
  eat(): void { /* ... */ }
  sleep(): void { /* ... */ }
}

class RobotWorker implements Workable {
  work(): void { /* ... */ }
}
```

#### D — Dependency Inversion
Depend upon abstractions, not concretions.

**❌ Violation:**
```typescript
class OrderService {
  private db = new MySQLDatabase();    // tightly coupled
  private mailer = new SendGridMail(); // tightly coupled

  async process(order: Order): Promise<void> {
    await this.db.save(order);
    await this.mailer.sendConfirmation(order);
  }
}
```

**✅ Fix — Inject abstractions:**
```typescript
interface Database { save(order: Order): Promise<void>; }
interface MailService { sendConfirmation(order: Order): Promise<void>; }

class OrderService {
  constructor(
    private db: Database,
    private mailer: MailService
  ) {}

  async process(order: Order): Promise<void> {
    await this.db.save(order);
    await this.mailer.sendConfirmation(order);
  }
}
```

### 2. Clean Code & Readability

#### Meaningful Names

**❌ Bad:**
```typescript
const d = new Date();                           // what is d?
const lst = await getData();                    // what data?
const fn = (a: number, b: number) => a * b;     // what does fn do?
```

**✅ Good:**
```typescript
const currentUtcTimestamp = new Date();
const pendingOrders = await fetchPendingOrders();
const calculateDiscount = (price: number, rate: number): number => price * rate;
```

#### Small Functions — One Thing

**❌ Too many responsibilities:**
```typescript
async function handleRequest(req: Request): Promise<Response> {
  const body = await req.json();
  if (!body.email || !body.password) return new Response('Bad request', { status: 400 });
  const user = await db.users.findUnique({ where: { email: body.email } });
  if (!user) return new Response('Not found', { status: 404 });
  const valid = await bcrypt.compare(body.password, user.passwordHash);
  if (!valid) return new Response('Unauthorized', { status: 401 });
  const token = jwt.sign({ id: user.id, role: user.role }, SECRET, { expiresIn: '1h' });
  await logger.info(`Login success: ${user.id}`);
  return new Response(JSON.stringify({ token }), { status: 200 });
}
```

**✅ Refactored into small focused functions:**
```typescript
async function handleLoginRequest(req: Request): Promise<Response> {
  const credentials = await parseJsonBody<LoginInput>(req);
  const validationError = validateLoginInput(credentials);
  if (validationError) return badRequest(validationError);

  const user = await lookupUserByEmail(credentials.email);
  if (!user) return notFound('User');

  const token = await authenticateUser(user, credentials.password);
  if (!token) return unauthorized('Invalid password');

  await logLoginSuccess(user.id);
  return ok({ token });
}

function validateLoginInput(input: unknown): ValidationError | null { /* ... */ }
async function lookupUserByEmail(email: string): Promise<User | null> { /* ... */ }
async function authenticateUser(user: User, password: string): Promise<string | null> { /* ... */ }
```

#### Avoid Side Effects

**❌ Impure / side-effecting:**
```typescript
let cache: Map<string, Result> = new Map();

function process(id: string): Result {
  if (cache.has(id)) return cache.get(id)!;       // reads external state
  const result = expensiveComputation(id);
  cache.set(id, result);                          // mutates external state
  return result;
}
```

**✅ Pure / no side effects:**
```typescript
function process(id: string, cache: Map<string, Result>): {
  result: Result;
  updatedCache: Map<string, Result>;
} {
  if (cache.has(id)) return { result: cache.get(id)!, updatedCache: cache };
  const result = expensiveComputation(id);
  const updatedCache = new Map(cache).set(id, result);
  return { result, updatedCache };
}
```

#### Self-Documenting Code

**❌ Comments explain "what" (noise):**
```typescript
// Add 1 to the counter
counter = counter + 1;           // ← obvious, comment is noise
```

**✅ Comments explain "why" (value):**
```typescript
// We subtract 1 because the DB index is 0-based but the UI shows 1-based
const dbIndex = uiIndex - 1;
```

### 3. Clean Architecture

#### Folder Structure Example

```
src/
├── core/                       ← Innermost layer — zero dependencies
│   ├── entities/
│   │   └── Order.ts            ← Business objects (no framework imports)
│   ├── use-cases/
│   │   └── PlaceOrder.ts       ← Application business rules
│   └── ports/
│       ├── OrderRepository.ts  ← Interface (abstraction)
│       └── PaymentGateway.ts   ← Interface (abstraction)
│
├── adapters/                   ← Middle layer — depends on core
│   ├── controllers/
│   │   └── OrderController.ts  ← HTTP handler → calls use case
│   ├── repositories/
│   │   └── PostgresOrderRepo.ts ← Implements OrderRepository
│   └── gateways/
│       └── StripePayment.ts    ← Implements PaymentGateway
│
├── infrastructure/             ← Outermost layer — framework details
│   ├── database/
│   │   └── migrations/
│   ├── server/
│   │   └── expressApp.ts
│   └── config/
│       └── env.ts
│
└── main.ts                     ← Composition root (wires everything)
```

#### Dependency Flow

```
[Infrastructure]  ──depends on──►  [Adapters]  ──depends on──►  [Core]
     (Express, Postgres)         (Controllers, Repos)         (Entities, Use Cases)

Dependencies ALWAYS point INWARD. Core NEVER knows about Express or Postgres.
```

#### Dependency Rule in Action

```typescript
// core/ports/OrderRepository.ts  ← pure interface, no framework
export interface OrderRepository {
  save(order: Order): Promise<void>;
  findById(id: string): Promise<Order | null>;
}

// adapters/repositories/PostgresOrderRepo.ts  ← framework detail, depends on core
import { OrderRepository, Order } from '../../core';
import { PrismaClient } from '@prisma/client';

export class PostgresOrderRepo implements OrderRepository {
  constructor(private prisma: PrismaClient) {}
  async save(order: Order): Promise<void> {
    await this.prisma.order.create({ data: order.toJSON() });
  }
  async findById(id: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { id } });
    return row ? Order.fromJSON(row) : null;
  }
}
```

### 4. Best Practices (DRY / KISS / YAGNI)

#### DRY — Don't Repeat Yourself

**❌ Duplication:**
```typescript
function formatUserName(user: { first: string; last: string }): string {
  return `${user.first} ${user.last}`.trim();
}

function formatAdminName(admin: { firstName: string; lastName: string }): string {
  return `${admin.firstName} ${admin.lastName}`.trim();
}
```

**✅ Unified:**
```typescript
interface Named { first: string; last: string; }
function formatFullName(person: Named): string {
  return `${person.first} ${person.last}`.trim();
}
```

#### KISS — Keep It Simple

**❌ Over-engineered:**
```typescript
class FibonacciCalculator {
  private cache = new Map<number, number>();
  
  calculate(n: number, strategy: 'recursive' | 'iterative' | 'formula' = 'iterative'): number {
    if (n < 0) throw new InvalidFibonacciInputError('Cannot be negative');
    if (this.cache.has(n)) return this.cache.get(n)!;
    const result = strategy === 'recursive' ? this.recursive(n)
                  : strategy === 'formula' ? this.formula(n)
                  : this.iterative(n);
    this.cache.set(n, result);
    return result;
  }
  // ... 80 more lines
}
```

**✅ Simple:**
```typescript
function fibonacci(n: number): number {
  if (n <= 1) return n;
  let [a, b] = [0, 1];
  for (let i = 2; i <= n; i++) [a, b] = [b, a + b];
  return b;
}
```

#### YAGNI — You Ain't Gonna Need It

**❌ Building for hypothetical future needs:**
```typescript
class UserManager {
  // Plugin system for user validation — not needed yet!
  private validators: UserValidator[] = [];
  registerValidator(v: UserValidator): void { this.validators.push(v); }

  // Multi-tenant support — not needed yet!
  async getUsers(tenantId?: string): Promise<User[]> {
    if (tenantId) return db.users.findMany({ where: { tenantId } });
    return db.users.findMany();
  }

  // Export to 5 formats — only CSV is needed today
  async export(format: 'csv' | 'json' | 'xml' | 'pdf' | 'excel'): Promise<Buffer> { /* ... */ }
}
```

**✅ Only what's needed today:**
```typescript
class UserService {
  constructor(private repo: UserRepository) {}
  async getUsers(): Promise<User[]> { return this.repo.findAll(); }
}
```

#### Composition over Inheritance

**❌ Deep inheritance:**
```typescript
class Animal { eat(): void { /* ... */ } }
class Bird extends Animal { fly(): void { /* ... */ } }
class Penguin extends Bird { /* penguins can't fly, breaks LSP */ }
```

**✅ Composition:**
```typescript
interface MovementStrategy { move(): void; }
class WalkStrategy implements MovementStrategy { move(): void { console.log('Walking'); } }
class FlyStrategy implements MovementStrategy { move(): void { console.log('Flying'); } }

class Animal {
  constructor(private movement: MovementStrategy) {}
  move(): void { this.movement.move(); }
}

const penguin = new Animal(new WalkStrategy());
const eagle = new Animal(new FlyStrategy());
```

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

## Workflow

When applying the Code Philosophy skill during planning, implementation, or code review:

1. **Analyze** — Read the code and identify which principles are violated. Use the Code Review Checklist (Section 9) as a systematic guide. Look for: large functions, duplicated logic, tight coupling, missing abstractions, security holes, unstructured logs, and untestable code.

2. **Identify** — Point out specific violations with precision. Reference the exact principle and line or function:
   - *"The `createUser` method (lines 12-30) violates SRP — it handles validation, persistence, email sending, and logging."*
   - *"This function has O(n²) complexity from nested loops. It can be reduced to O(n) with a Set."*
   - *"Database credentials are hardcoded. They should be moved to environment variables."*

3. **Propose** — Show the refactored version. Present a before/after comparison with the exact fixes applied. Use the Refactoring Guide (Section 10) patterns — extract method, replace conditionals with polymorphism, extract parameter object — to guide the transformation.

4. **Explain** — Briefly (2-3 sentences) describe why the new implementation is superior in terms of:
   - **Maintainability**: Easier to read, modify, or extend
   - **Testability**: Can be unit-tested with mocks or in-memory implementations
   - **Security**: Eliminates injection risks, secrets leakage, or validation gaps
   - **Performance**: Reduces time/space complexity, avoids unnecessary work
   - **Observability**: Adds structured logging and correlation IDs for debugging

5. **Verify** — After proposing changes, confirm the result is:
   - Buildable (no compilation errors)
   - Lint-clean (no warnings or style violations)
   - Testable (dependencies are injectable)
   - Consistent (follows the same patterns as the surrounding codebase)
