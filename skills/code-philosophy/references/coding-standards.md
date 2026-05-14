---
name: coding-standards
description: Detailed reference for SOLID principles, clean code, clean architecture, and best practices (DRY/KISS/YAGNI/composition).
---

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
