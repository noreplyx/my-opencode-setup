---
name: coding-standards
description: Detailed reference for SOLID principles, clean code, clean architecture, and best practices (DRY/KISS/YAGNI/composition).
---

## Core Principles

### 1. SOLID Principles

#### S — Single Responsibility
A class or function should have one, and only one, reason to change.

**❌ Violation:**
```js
class UserService {
  async createUser(data) {
    const hashed = await hashPassword(data.password, 10);
    const user = await db.users.create({ ...data, password: hashed });
    await emailClient.sendWelcome(user.email, user.name);
    logger.info(`User created: ${user.id}`);
    return user;
  }
}
```

**✅ Fix — Extract responsibilities:**
```js
class UserCreator {
  constructor(repo, hasher) {
    this.repo = repo;
    this.hasher = hasher;
  }
  async execute(data) {
    const hashed = await this.hasher.hash(data.password);
    return this.repo.save({ ...data, password: hashed });
  }
}

class WelcomeEmailSender {
  constructor(mailer) {
    this.mailer = mailer;
  }
  async sendWelcome(user) {
    await this.mailer.send(user.email, 'Welcome', `Hi ${user.name}!`);
  }
}
```

#### O — Open/Closed
Software entities should be open for extension but closed for modification.

**❌ Violation:**
```js
function getDiscount(price, customerType) {
  if (customerType === 'regular') return price * 0.05;
  if (customerType === 'premium') return price * 0.10;
  if (customerType === 'vip') return price * 0.20; // ← modifies existing function
  return 0;
}
```

**✅ Fix — Extend via strategy:**
```js
// Strategy contract: { apply(price) }

class RegularDiscount {
  apply(price) { return price * 0.05; }
}

class PremiumDiscount {
  apply(price) { return price * 0.10; }
}

// New types added via NEW classes, not by modifying existing code
class VipDiscount {
  apply(price) { return price * 0.20; }
}
```

#### L — Liskov Substitution
Objects of a superclass should be replaceable with objects of its subclasses without breaking the application.

**❌ Violation:**
```js
class Rectangle {
  constructor(w, h) {
    this.w = w;
    this.h = h;
  }
  setWidth(w) { this.w = w; }
  setHeight(h) { this.h = h; }
  getArea() { return this.w * this.h; }
}

class Square extends Rectangle {
  setWidth(w) { this.w = w; this.h = w; } // breaks LSP
  setHeight(h) { this.h = h; this.w = h; }
}

function resize(rect) {
  rect.setWidth(5);
  rect.setHeight(10);
  console.log(rect.getArea()); // Rectangle: 50, Square: 100 ← wrong!
}
```

**✅ Fix — Favor composition or a shared abstraction:**
```js
// Shape contract: { getArea() }

class RectangleV2 {
  constructor(w, h) {
    this.w = w;
    this.h = h;
  }
  getArea() { return this.w * this.h; }
}

class SquareV2 {
  constructor(side) {
    this.side = side;
  }
  getArea() { return this.side * this.side; }
}
```

#### I — Interface Segregation
No client should be forced to depend on methods it does not use.

**❌ Violation:**
```js
// Worker contract: { work(), eat(), sleep() }
class Robot {
  work() { /* ok */ }
  eat() { throw new Error('Robots do not eat'); }  // forced dependency
  sleep() { throw new Error('Robots do not sleep'); }
}
```

**✅ Fix — Segregated contracts:**
```js
// Separate contracts
// Workable: { work() }
// Eatable: { eat() }
// Sleepable: { sleep() }

class HumanWorker {
  work() { /* ... */ }
  eat() { /* ... */ }
  sleep() { /* ... */ }
}

class RobotWorker {
  work() { /* ... */ }
}
```

#### D — Dependency Inversion
Depend upon abstractions, not concretions.

**❌ Violation:**
```js
class OrderService {
  constructor() {
    this.db = new MySQLDatabase();    // tightly coupled
    this.mailer = new SendGridMail(); // tightly coupled
  }

  async process(order) {
    await this.db.save(order);
    await this.mailer.sendConfirmation(order);
  }
}
```

**✅ Fix — Inject abstractions:**
```js
// Database contract: { save(order) }
// MailService contract: { sendConfirmation(order) }

class OrderService {
  constructor(db, mailer) {
    this.db = db;
    this.mailer = mailer;
  }

  async process(order) {
    await this.db.save(order);
    await this.mailer.sendConfirmation(order);
  }
}
```

### 2. Clean Code & Readability

#### Meaningful Names

**❌ Bad:**
```js
const d = new Date();                        // what is d?
const lst = await getData();                 // what data?
const fn = (a, b) => a * b;                  // what does fn do?
```

**✅ Good:**
```js
const currentUtcTimestamp = new Date();
const pendingOrders = await fetchPendingOrders();
const calculateDiscount = (price, rate) => price * rate;
```

#### Small Functions — One Thing

**❌ Too many responsibilities:**
```js
async function handleRequest(req) {
  const body = await req.json();
  if (!body.email || !body.password) return { status: 400, body: 'Bad request' };
  const user = await db.users.findByEmail(body.email);
  if (!user) return { status: 404, body: 'Not found' };
  const valid = await passwordVerifier.verify(body.password, user.passwordHash);
  if (!valid) return { status: 401, body: 'Unauthorized' };
  const token = tokenIssuer.issue({ id: user.id, role: user.role });
  await logger.info(`Login success: ${user.id}`);
  return { status: 200, body: { token } };
}
```

**✅ Refactored into small focused functions:**
```js
async function handleLoginRequest(request) {
  const credentials = await parseJsonBody(request);
  const validationError = validateLoginInput(credentials);
  if (validationError) return badRequest(validationError);

  const user = await lookupUserByEmail(credentials.email);
  if (!user) return notFound('User');

  const token = await authenticateUser(user, credentials.password);
  if (!token) return unauthorized('Invalid password');

  await logLoginSuccess(user.id);
  return ok({ token });
}

function validateLoginInput(input) { /* ... */ }
async function lookupUserByEmail(email) { /* ... */ }
async function authenticateUser(user, password) { /* ... */ }
```

#### Avoid Side Effects

**❌ Impure / side-effecting:**
```js
let cache = new Map();

function process(id) {
  if (cache.has(id)) return cache.get(id);  // reads external state
  const result = expensiveComputation(id);
  cache.set(id, result);                    // mutates external state
  return result;
}
```

**✅ Pure / no side effects:**
```js
function process(id, cache) {
  if (cache.has(id)) return { result: cache.get(id), updatedCache: cache };
  const result = expensiveComputation(id);
  const updatedCache = new Map(cache).set(id, result);
  return { result, updatedCache };
}
```

#### Self-Documenting Code

**❌ Comments explain "what" (noise):**
```js
// Add 1 to the counter
counter = counter + 1;           // ← obvious, comment is noise
```

**✅ Comments explain "why" (value):**
```js
// We subtract 1 because the DB index is 0-based but the UI shows 1-based
const dbIndex = uiIndex - 1;
```

### 3. Clean Architecture

#### Folder Structure Example

```
src/
├── core/                       ← Innermost layer — zero dependencies
│   ├── entities/
│   │   └── Order.js            ← Business objects (no framework imports)
│   ├── use-cases/
│   │   └── PlaceOrder.js       ← Application business rules
│   └── ports/
│       ├── OrderRepository.js  ← Interface (abstraction)
│       └── PaymentGateway.js   ← Interface (abstraction)
│
├── adapters/                   ← Middle layer — depends on core
│   ├── controllers/
│   │   └── OrderController.js  ← HTTP handler → calls use case
│   ├── repositories/
│   │   └── PostgresOrderRepo.js ← Implements OrderRepository
│   └── gateways/
│       └── StripePayment.js    ← Implements PaymentGateway
│
├── infrastructure/             ← Outermost layer — framework details
│   ├── database/
│   │   └── migrations/
│   ├── server/
│   │   └── httpServer.js
│   └── config/
│       └── env.js
│
└── main.js                     ← Composition root (wires everything)
```

#### Dependency Flow

```
[Infrastructure]  ──depends on──►  [Adapters]  ──depends on──►  [Core]
     (HTTP, Postgres)            (Controllers, Repos)         (Entities, Use Cases)

Dependencies ALWAYS point INWARD. Core NEVER knows about HTTP or Postgres.
```

#### Dependency Rule in Action

```js
// core/ports/OrderRepository.js  ← pure contract, no framework
// Contract: { save(order), findById(id) }

// adapters/repositories/PostgresOrderRepo.js  ← framework detail, depends on core
class PostgresOrderRepo {
  constructor(db) {
    this.db = db;
  }
  async save(order) {
    await this.db.orders.create({ data: order.toJSON() });
  }
  async findById(id) {
    const row = await this.db.orders.findUnique({ where: { id } });
    return row ? Order.fromJSON(row) : null;
  }
}
```

### 4. Best Practices (DRY / KISS / YAGNI)

#### DRY — Don't Repeat Yourself

**❌ Duplication:**
```js
function formatUserName(user) {
  return `${user.first} ${user.last}`.trim();
}

function formatAdminName(admin) {
  return `${admin.firstName} ${admin.lastName}`.trim();
}
```

**✅ Unified:**
```js
function formatFullName(person) {
  return `${person.first} ${person.last}`.trim();
}
```

#### KISS — Keep It Simple

**❌ Over-engineered:**
```js
class FibonacciCalculator {
  constructor() {
    this.cache = new Map();
  }

  calculate(n, strategy = 'iterative') {
    if (n < 0) throw new Error('Cannot be negative');
    if (this.cache.has(n)) return this.cache.get(n);
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
```js
function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) [a, b] = [b, a + b];
  return b;
}
```

#### YAGNI — You Ain't Gonna Need It

**❌ Building for hypothetical future needs:**
```js
class UserManager {
  // Plugin system for user validation — not needed yet!
  constructor() {
    this.validators = [];
  }
  registerValidator(v) { this.validators.push(v); }

  // Multi-tenant support — not needed yet!
  async getUsers(tenantId) {
    if (tenantId) return db.users.findMany({ where: { tenantId } });
    return db.users.findMany();
  }

  // Export to 5 formats — only CSV is needed today
  async export(format) { /* ... */ }
}
```

**✅ Only what's needed today:**
```js
class UserService {
  constructor(repo) {
    this.repo = repo;
  }
  async getUsers() { return this.repo.findAll(); }
}
```

#### Composition over Inheritance

**❌ Deep inheritance:**
```js
class Animal { eat() { /* ... */ } }
class Bird extends Animal { fly() { /* ... */ } }
class Penguin extends Bird { /* penguins can't fly, breaks LSP */ }
```

**✅ Composition:**
```js
// Movement strategy: { move() }
class WalkStrategy { move() { console.log('Walking'); } }
class FlyStrategy { move() { console.log('Flying'); } }

class Animal {
  constructor(movement) {
    this.movement = movement;
  }
  move() { this.movement.move(); }
}

const penguin = new Animal(new WalkStrategy());
const eagle = new Animal(new FlyStrategy());
```
