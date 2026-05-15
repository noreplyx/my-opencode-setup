---
name: data-and-resilience
description: Detailed reference for caching strategies, database patterns, testing strategy, and error handling & resilience.
---

### 4. Caching Strategies

Cache aggressively but invalidate carefully. Choose strategies based on data criticality and staleness tolerance.

- **Multi-Layer Caching:**

  ```js
  // Layer 1: In-memory cache (fastest, local to instance)
  // Layer 2: Distributed cache (e.g. Redis — shared across instances)
  // Layer 3: Database (source of truth)

  async function getUserProfile(userId) {
    const key = `user:${userId}:profile`;

    // L1: Check in-memory cache
    const l1Hit = memoryCache.get(key);
    if (l1Hit) return l1Hit;

    // L2: Check distributed cache
    const l2Hit = await cache.get(key);
    if (l2Hit) {
      memoryCache.set(key, l2Hit, { ttl: 60 });  // Populate L1 for 60s
      return l2Hit;
    }

    // L3: Fetch from database
    const profile = await db.users.findByPk(userId);
    if (!profile) throw new NotFoundError('User not found');

    // Populate both caches
    await cache.set(key, profile, { ttl: 300 });  // L2: 5 minutes
    memoryCache.set(key, profile, { ttl: 60 });   // L1: 1 minute

    return profile;
  }
  ```

- **Cache Invalidation Strategies:**

  ```js
  // Strategy 1: Write-Through (update cache synchronously on write)
  async function updateUserEmail(userId, email) {
    const user = await db.users.update({ where: { id: userId }, data: { email } });
    const cacheKey = `user:${userId}:profile`;
    await cache.set(cacheKey, user, { ttl: 300 });
    memoryCache.del(cacheKey);
    return user;
  }

  // Strategy 2: Event-Driven Invalidation (cache is invalidated by domain events)
  async function updateUserEmail(userId, email) {
    const user = await db.users.update({ where: { id: userId }, data: { email } });
    await eventBus.publish('user.email.updated', { userId, email });
    return user;
  }

  // Cache service subscribes to invalidation events
  eventBus.subscribe('user.email.updated', async (event) => {
    const cacheKey = `user:${event.userId}:profile`;
    await cache.del(cacheKey);
    memoryCache.del(cacheKey);
  });

  // Strategy 3: TTL-Based (simplest — let entries expire naturally)
  // Suitable for data that can be slightly stale (e.g., product catalog)
  ```

- **Thundering Herd Prevention:** Use probabilistic early expiration or locking to prevent multiple concurrent requests from hitting the database when a cache key expires.

  ```js
  async function getExpensiveData(key) {
    const cached = await cache.get(key);
    if (cached) {
      // Probabilistic early expiration: refresh early if TTL is almost up
      const ttl = await cache.ttl(key);
      if (ttl < 60 && Math.random() < 0.1) {
        // Only ~10% of requests trigger a background refresh
        refreshDataInBackground(key);
      }
      return cached;
    }

    // Mutex: only one instance fetches from DB
    const lockKey = `lock:cache:${key}`;
    const acquired = await cache.setNX(lockKey, 'locked', { ttl: 10 });
    if (!acquired) {
      // Wait briefly and retry cache
      await sleep(50);
      return getExpensiveData(key); // Retry
    }

    try {
      const data = await fetchFromDatabase();
      await cache.set(key, data, { ttl: 300 });
      return data;
    } finally {
      await cache.del(lockKey);
    }
  }
  ```

### 5. Database Patterns & Data Access

Abstract data access behind interfaces to decouple business logic from storage details.

- **Repository Pattern:**

  ```js
  // Repository interface (domain layer — no ORM dependency)
  // Implementations: findById, findByEmail, save, softDelete

  // Repository implementation (infrastructure layer — ORM-specific)
  class PostgresUserRepository {
    constructor(db) {
      this.db = db;
    }

    async findById(id) {
      const record = await this.db.users.findByPk(id);
      return record ? this.toDomain(record) : null;
    }

    async findByEmail(email) {
      const record = await this.db.users.findOne({ where: { email } });
      return record ? this.toDomain(record) : null;
    }

    async save(user) {
      const record = await this.db.users.upsert({
        where: { id: user.id },
        create: this.toPersistence(user),
        update: this.toPersistence(user),
      });
      return this.toDomain(record);
    }

    async softDelete(id) {
      await this.db.users.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    }

    toDomain(record) {
      return { id: record.id, email: record.email, name: record.name, createdAt: record.createdAt };
    }

    toPersistence(user) {
      return { id: user.id, email: user.email, name: user.name, updatedAt: new Date() };
    }
  }
  ```

- **Migrations:** Always use versioned, reversible migration scripts. Never modify production schemas directly.

  ```js
  // Migration: 20250601000000_add_order_status_index.ts
  // Always provide both up() and down() methods

  export async function up(db) {
    await db.schema.alterTable('orders', (table) => {
      table.index(['status', 'created_at'], 'idx_orders_status_created');
    });
  }

  export async function down(db) {
    await db.schema.alterTable('orders', (table) => {
      table.dropIndex(['status', 'created_at'], 'idx_orders_status_created');
    });
  }
  ```

- **Query Optimization Tips:**

  ```js
  // BAD: N+1 query — hitting DB in a loop
  const orders = await db.orders.findMany({ where: { userId } });
  for (const order of orders) {
    const items = await db.orderItems.findMany({ where: { orderId: order.id } });
    order.items = items;
  }

  // GOOD: Eager loading — single query with JOIN
  const ordersWithItems = await db.orders.findMany({
    where: { userId },
    include: { items: true },
  });

  // GOOD: Batch loading (DataLoader pattern)
  async function getOrdersWithItems(userId) {
    const orders = await db.orders.findMany({ where: { userId } });
    const orderIds = orders.map((o) => o.id);
    const items = await db.orderItems.findMany({ where: { orderId: { in: orderIds } } });

    const itemsByOrderId = groupBy(items, 'orderId');
    return orders.map((order) => ({ ...order, items: itemsByOrderId.get(order.id) || [] }));
  }
  ```

- **Soft Deletes & Auditing:**

  ```js
  // Schema includes audit columns
  // created_at, updated_at, deleted_at (nullable), created_by, updated_by

  // Query filters always exclude soft-deleted records by default
  const activeUsers = await db.users.findMany({
    where: { deletedAt: null },
  });
  ```

- **Transactional Boundaries:** Keep transactions as short as possible. Never hold a transaction open across external API calls or long-running operations.

  ```js
  // GOOD: Narrow transaction — only DB operations inside the transaction
  async function transferFunds(fromId, toId, amount) {
    await db.transaction(async (tx) => {
      const from = await tx.accounts.update({
        where: { id: fromId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (!from) throw new InsufficientFundsError();

      await tx.accounts.update({
        where: { id: toId },
        data: { balance: { increment: amount } },
      });
    });

    // External notification AFTER the transaction commits
    await eventBus.publish('funds.transferred', { fromId, toId, amount });
  }

  // BAD: External call inside the transaction — holding locks too long
  await db.transaction(async (tx) => {
    await tx.accounts.update(...);
    await paymentGateway.charge(amount); // ❌ External HTTP call inside transaction!
    await tx.accounts.update(...);
  });
  ```

### 6. Testing Strategy

Backend services require multiple layers of testing to ensure correctness and resilience.

- **Unit Tests:** Test business logic in isolation. Mock all external dependencies (DB, cache, message broker).

  ```js
  describe('OrderService', () => {
    let service;
    let mockRepo;
    let mockEventBus;

    beforeEach(() => {
      mockRepo = { save: jest.fn(), findById: jest.fn() };
      mockEventBus = { publish: jest.fn() };
      service = new OrderService(mockRepo, mockEventBus);
    });

    it('should create order and publish event', async () => {
      const cart = { userId: 'user_1', items: [{ sku: 'SKU001', quantity: 2 }] };
      mockRepo.save.mockResolvedValue({ id: 'ord_1', userId: 'user_1', total: 100 });

      const result = await service.createOrder(cart);

      expect(result.total).toBe(100);
      expect(mockEventBus.publish).toHaveBeenCalledWith('order.created', {
        orderId: 'ord_1',
        userId: 'user_1',
        total: 100,
      });
    });
  });
  ```

- **Integration Tests:** Test against real (or containerized) dependencies — database, cache, message queue.

  ```js
  describe('PostgresUserRepository (integration)', () => {
    let repo;
    let db;

    beforeAll(async () => {
      db = createDbConnection({ url: process.env.TEST_DATABASE_URL });
      await db.query('TRUNCATE TABLE users CASCADE');
      repo = new PostgresUserRepository(db);
    });

    afterAll(async () => {
      await db.disconnect();
    });

    it('should persist and retrieve a user', async () => {
      const user = { id: 'usr_1', email: 'test@test.com', name: 'Test User' };
      await repo.save(user);

      const found = await repo.findById('usr_1');
      expect(found.email).toBe('test@test.com');
    });
  });
  ```

- **Contract Tests:** Verify that API responses match the expected schema. Use tools like Pact or OpenAPI-based contract testing.

  ```js
  describe('GET /api/v1/users/:id (contract)', () => {
    it('should return a valid user response', async () => {
      const response = await sendRequest({ method: 'GET', path: '/api/v1/users/usr_123' });
      expect(response.statusCode).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('email');
    });

    it('should return a valid error on not found', async () => {
      const response = await sendRequest({ method: 'GET', path: '/api/v1/users/nonexistent' });
      expect(response.statusCode).toBe(404);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });
  ```

- **End-to-End Tests:** Test critical user journeys across multiple services. Run against a staging-like environment.

  ```js
  describe('Checkout E2E', () => {
    it('should complete full checkout flow', async () => {
      const session = await apiClient.loginAs('test@user.com');
      const product = await apiClient.getProduct('SKU001');

      const cart = await apiClient.addToCart(session.token, product.id, 1);
      const order = await apiClient.checkout(session.token, cart.id);

      expect(order.status).toBe('confirmed');
      expect(order.total).toBe(product.price);

      // Verify inventory was decremented
      const updatedProduct = await apiClient.getProduct('SKU001');
      expect(updatedProduct.stock).toBe(product.stock - 1);
    });
  });
  ```

### 7. Error Handling & Resilience

Backend services must gracefully handle failures and recover without manual intervention.

- **Structured Error Responses:** Every error returned to the client must follow the standard error envelope with a machine-readable `code`.

  ```js
  // Custom error classes
  class AppError extends Error {
    constructor(statusCode, code, message, details) {
      super(message);
      this.name = this.constructor.name;
      this.statusCode = statusCode;
      this.code = code;
      this.details = details;
    }
  }

  class NotFoundError extends AppError {
    constructor(resource, id) {
      super(404, 'NOT_FOUND', `${resource} with id '${id}' not found`);
    }
  }

  class ValidationError extends AppError {
    constructor(details) {
      super(422, 'VALIDATION_ERROR', 'Request validation failed', details);
    }
  }

  class ConflictError extends AppError {
    constructor(message) {
      super(409, 'CONFLICT', message);
    }
  }

  class RateLimitedError extends AppError {
    constructor(retryAfter) {
      super(429, 'RATE_LIMITED', `Too many requests. Retry after ${retryAfter} seconds`);
    }
  }

  // Global error handler
  function errorHandler(err, request, sendResponse) {
    if (err instanceof AppError) {
      sendResponse(err.statusCode, {
        success: false,
        error: { code: err.code, message: err.message, details: err.details },
        meta: { requestId: request.id, timestamp: new Date().toISOString() },
      });
      return;
    }

    // Unexpected errors — log and return generic 500
    logger.error({ err, requestId: request.id }, 'Unhandled server error');
    sendResponse(500, {
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      meta: { requestId: request.id, timestamp: new Date().toISOString() },
    });
  }
  ```

- **Retry with Exponential Backoff:** For transient failures (network timeouts, database deadlocks, 503 responses).

  ```js
  async function withRetry(fn, options = { maxRetries: 3, baseDelayMs: 100 }) {
    let lastError = null;
    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err;
        if (attempt === options.maxRetries) break;

        const delay = options.baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
        logger.warn({ attempt, delay, err: lastError.message }, 'Retrying operation');
        await sleep(delay);
      }
    }
    throw lastError;
  }

  // Usage
  const user = await withRetry(() => db.users.findByPk(userId));
  ```

- **Circuit Breaker Pattern:** Prevent cascading failures by stopping calls to a failing dependency once error thresholds are exceeded.

  ```js
  const CircuitState = { CLOSED: 'CLOSED', OPEN: 'OPEN', HALF_OPEN: 'HALF_OPEN' };

  class CircuitBreaker {
    constructor(options = {}) {
      this.state = CircuitState.CLOSED;
      this.failureCount = 0;
      this.lastFailureTime = 0;
      this.threshold = options.threshold || 5;
      this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    }

    async call(fn) {
      if (this.state === CircuitState.OPEN) {
        if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
          this.state = CircuitState.HALF_OPEN;
        } else {
          throw new Error('Service unavailable — circuit breaker open');
        }
      }

      try {
        const result = await fn();
        if (this.state === CircuitState.HALF_OPEN) {
          this.state = CircuitState.CLOSED;
          this.failureCount = 0;
        }
        return result;
      } catch (err) {
        this.failureCount++;
        this.lastFailureTime = Date.now();
        if (this.failureCount >= this.threshold) {
          this.state = CircuitState.OPEN;
          logger.error('Circuit breaker opened due to repeated failures');
        }
        throw err;
      }
    }
  }

  // Usage
  const paymentCircuit = new CircuitBreaker();
  const result = await paymentCircuit.call(() => paymentGateway.charge(orderId));
  ```

- **Timeouts:** Always set timeouts on external calls. A missing timeout can exhaust connection pools and bring down a service.

  ```js
  async function fetchWithTimeout(url, timeoutMs = 5000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }
  ```
