---
name: data-and-resilience
description: Detailed reference for caching strategies, database patterns, testing strategy, and error handling & resilience.
---

### 4. Caching Strategies

Cache aggressively but invalidate carefully. Choose strategies based on data criticality and staleness tolerance.

- **Multi-Layer Caching:**

  ```typescript
  // Layer 1: In-memory cache (fastest, local to instance)
  // Layer 2: Distributed cache (Redis — shared across instances)
  // Layer 3: Database (source of truth)

  async function getUserProfile(userId: string): Promise<UserProfile> {
    // L1: Check in-memory cache
    const l1Key = `user:${userId}:profile`;
    const l1Hit = memoryCache.get<UserProfile>(l1Key);
    if (l1Hit) return l1Hit;

    // L2: Check distributed cache
    const l2Key = `user:${userId}:profile`;
    const l2Hit = await redis.get<UserProfile>(l2Key);
    if (l2Hit) {
      memoryCache.set(l1Key, l2Hit, { ttl: 60 });  // Populate L1 for 60s
      return l2Hit;
    }

    // L3: Fetch from database
    const profile = await db.users.findUnique({ where: { id: userId } });
    if (!profile) throw new NotFoundError('User not found');

    // Populate both caches
    await redis.set(l2Key, profile, { ttl: 300 });  // L2: 5 minutes
    memoryCache.set(l1Key, profile, { ttl: 60 });   // L1: 1 minute

    return profile;
  }
  ```

- **Cache Invalidation Strategies:**

  ```typescript
  // Strategy 1: Write-Through (update cache synchronously on write)
  async function updateUserEmail(userId: string, email: string): Promise<User> {
    const user = await db.users.update({ where: { id: userId }, data: { email } });
    const cacheKey = `user:${userId}:profile`;
    await redis.set(cacheKey, user, { ttl: 300 });
    memoryCache.del(cacheKey);
    return user;
  }

  // Strategy 2: Event-Driven Invalidation (cache is invalidated by domain events)
  async function updateUserEmail(userId: string, email: string): Promise<User> {
    const user = await db.users.update({ where: { id: userId }, data: { email } });
    await eventBus.publish('user.email.updated', { userId, email });
    return user;
  }

  // Cache service subscribes to invalidation events
  eventBus.subscribe('user.email.updated', async (event: { userId: string }) => {
    const cacheKey = `user:${event.userId}:profile`;
    await redis.del(cacheKey);
    memoryCache.del(cacheKey);
  });

  // Strategy 3: TTL-Based (simplest — let entries expire naturally)
  // Suitable for data that can be slightly stale (e.g., product catalog)
  ```

- **Thundering Herd Prevention:** Use probabilistic early expiration or locking to prevent multiple concurrent requests from hitting the database when a cache key expires.

  ```typescript
  async function getExpensiveData(key: string): Promise<Data> {
    const cached = await redis.get<Data>(key);
    if (cached) {
      // Probabilistic early expiration: refresh early if TTL is almost up
      const ttl = await redis.ttl(key);
      if (ttl < 60 && Math.random() < 0.1) {
        // Only ~10% of requests trigger a background refresh
        refreshDataInBackground(key);
      }
      return cached;
    }

    // Mutex: only one instance fetches from DB
    const lockKey = `lock:cache:${key}`;
    const acquired = await redis.setNX(lockKey, 'locked', { ttl: 10 });
    if (!acquired) {
      // Wait briefly and retry cache
      await sleep(50);
      return getExpensiveData(key); // Retry
    }

    try {
      const data = await fetchFromDatabase();
      await redis.set(key, data, { ttl: 300 });
      return data;
    } finally {
      await redis.del(lockKey);
    }
  }
  ```

### 5. Database Patterns & Data Access

Abstract data access behind interfaces to decouple business logic from storage details.

- **Repository Pattern:**

  ```typescript
  // Repository interface (domain layer — no ORM dependency)
  interface UserRepository {
    findById(id: string): Promise<User | null>;
    findByEmail(email: string): Promise<User | null>;
    save(user: User): Promise<User>;
    softDelete(id: string): Promise<void>;
  }

  // Repository implementation (infrastructure layer — ORM-specific)
  class PostgresUserRepository implements UserRepository {
    constructor(private readonly db: PrismaClient) {}

    async findById(id: string): Promise<User | null> {
      const record = await this.db.user.findUnique({ where: { id } });
      return record ? this.toDomain(record) : null;
    }

    async findByEmail(email: string): Promise<User | null> {
      const record = await this.db.user.findUnique({ where: { email } });
      return record ? this.toDomain(record) : null;
    }

    async save(user: User): Promise<User> {
      const record = await this.db.user.upsert({
        where: { id: user.id },
        create: this.toPersistence(user),
        update: this.toPersistence(user),
      });
      return this.toDomain(record);
    }

    async softDelete(id: string): Promise<void> {
      await this.db.user.update({
        where: { id },
        data: { deletedAt: new Date() },
      });
    }

    private toDomain(record: UserRecord): User {
      return new User(record.id, record.email, record.name, record.createdAt);
    }

    private toPersistence(user: User): UserRecord {
      return { id: user.id, email: user.email, name: user.name, updatedAt: new Date() };
    }
  }
  ```

- **Migrations:** Always use versioned, reversible migration scripts. Never modify production schemas directly.

  ```typescript
  // Migration: 20250601000000_add_order_status_index.ts
  // Always provide both up() and down() methods

  export async function up(db: Knex): Promise<void> {
    await db.schema.alterTable('orders', (table) => {
      table.index(['status', 'created_at'], 'idx_orders_status_created');
    });
  }

  export async function down(db: Knex): Promise<void> {
    await db.schema.alterTable('orders', (table) => {
      table.dropIndex(['status', 'created_at'], 'idx_orders_status_created');
    });
  }
  ```

- **Query Optimization Tips:**

  ```typescript
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

  // GOOD: Batch loading (DataLoader pattern for GraphQL / REST)
  async function getOrdersWithItems(userId: string): Promise<Order[]> {
    const orders = await db.orders.findMany({ where: { userId } });
    const orderIds = orders.map((o) => o.id);
    const items = await db.orderItems.findMany({ where: { orderId: { in: orderIds } } });

    const itemsByOrderId = groupBy(items, 'orderId');
    return orders.map((order) => ({ ...order, items: itemsByOrderId.get(order.id) || [] }));
  }
  ```

- **Soft Deletes & Auditing:**

  ```typescript
  // Schema includes audit columns
  // created_at, updated_at, deleted_at (nullable), created_by, updated_by

  // Query filters always exclude soft-deleted records by default
  const activeUsers = await db.user.findMany({
    where: { deletedAt: null },
  });
  ```

- **Transactional Boundaries:** Keep transactions as short as possible. Never hold a transaction open across external API calls or long-running operations.

  ```typescript
  // GOOD: Narrow transaction — only DB operations inside the transaction
  async function transferFunds(fromId: string, toId: string, amount: number): Promise<void> {
    await db.$transaction(async (tx) => {
      const from = await tx.account.update({
        where: { id: fromId, balance: { gte: amount } },
        data: { balance: { decrement: amount } },
      });
      if (!from) throw new InsufficientFundsError();

      await tx.account.update({
        where: { id: toId },
        data: { balance: { increment: amount } },
      });
    });

    // External notification AFTER the transaction commits
    await eventBus.publish('funds.transferred', { fromId, toId, amount });
  }

  // BAD: External call inside the transaction — holding locks too long
  await db.$transaction(async (tx) => {
    await tx.accounts.update(...);
    await paymentGateway.charge(amount); // ❌ External HTTP call inside transaction!
    await tx.accounts.update(...);
  });
  ```

### 6. Testing Strategy

Backend services require multiple layers of testing to ensure correctness and resilience.

- **Unit Tests:** Test business logic in isolation. Mock all external dependencies (DB, cache, message broker).

  ```typescript
  describe('OrderService', () => {
    let service: OrderService;
    let mockRepo: jest.Mocked<OrderRepository>;
    let mockEventBus: jest.Mocked<EventBus>;

    beforeEach(() => {
      mockRepo = { save: jest.fn(), findById: jest.fn() } as any;
      mockEventBus = { publish: jest.fn() } as any;
      service = new OrderService(mockRepo, mockEventBus);
    });

    it('should create order and publish event', async () => {
      const cart = new Cart('user_1', [{ sku: 'SKU001', quantity: 2 }]);
      mockRepo.save.mockResolvedValue(new Order('ord_1', 'user_1', 100));

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

  ```typescript
  describe('PostgresUserRepository (integration)', () => {
    let repo: PostgresUserRepository;
    let db: PrismaClient;

    beforeAll(async () => {
      db = new PrismaClient({ datasources: { db: { url: process.env.TEST_DATABASE_URL } } });
      await db.$executeRawUnsafe('TRUNCATE TABLE users CASCADE');
      repo = new PostgresUserRepository(db);
    });

    afterAll(async () => {
      await db.$disconnect();
    });

    it('should persist and retrieve a user', async () => {
      const user = new User('usr_1', 'test@test.com', 'Test User');
      await repo.save(user);

      const found = await repo.findById('usr_1');
      expect(found?.email).toBe('test@test.com');
    });
  });
  ```

- **Contract Tests:** Verify that API responses match the expected schema. Use tools like Pact or OpenAPI-based contract testing.

  ```typescript
  // Using supertest + OpenAPI validator
  describe('GET /api/v1/users/:id (contract)', () => {
    it('should return a valid user response', async () => {
      const response = await request(app).get('/api/v1/users/usr_123').expect(200);
      expect(response.body).toMatchSchema(userResponseSchema);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('id');
      expect(response.body.data).toHaveProperty('email');
    });

    it('should return a valid error on not found', async () => {
      const response = await request(app).get('/api/v1/users/nonexistent').expect(404);
      expect(response.body).toMatchSchema(errorResponseSchema);
      expect(response.body.error.code).toBe('NOT_FOUND');
    });
  });
  ```

- **End-to-End Tests:** Test critical user journeys across multiple services. Run against a staging-like environment.

  ```typescript
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

  ```typescript
  // Custom error classes
  class AppError extends Error {
    constructor(
      public readonly statusCode: number,
      public readonly code: string,
      message: string,
      public readonly details?: unknown
    ) {
      super(message);
      this.name = this.constructor.name;
    }
  }

  class NotFoundError extends AppError {
    constructor(resource: string, id: string) {
      super(404, 'NOT_FOUND', `${resource} with id '${id}' not found`);
    }
  }

  class ValidationError extends AppError {
    constructor(details: unknown) {
      super(422, 'VALIDATION_ERROR', 'Request validation failed', details);
    }
  }

  class ConflictError extends AppError {
    constructor(message: string) {
      super(409, 'CONFLICT', message);
    }
  }

  class RateLimitedError extends AppError {
    constructor(retryAfter: number) {
      super(429, 'RATE_LIMITED', `Too many requests. Retry after ${retryAfter} seconds`);
    }
  }

  // Global error handler middleware
  function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction): void {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        success: false,
        error: { code: err.code, message: err.message, details: err.details },
        meta: { requestId: req.id, timestamp: new Date().toISOString() },
      });
      return;
    }

    // Unexpected errors — log and return generic 500
    logger.error({ err, requestId: req.id }, 'Unhandled server error');
    res.status(500).json({
      success: false,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
      meta: { requestId: req.id, timestamp: new Date().toISOString() },
    });
  }
  ```

- **Retry with Exponential Backoff:** For transient failures (network timeouts, database deadlocks, 503 responses).

  ```typescript
  async function withRetry<T>(
    fn: () => Promise<T>,
    options: { maxRetries: number; baseDelayMs: number } = { maxRetries: 3, baseDelayMs: 100 }
  ): Promise<T> {
    let lastError: Error | null = null;
    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (err) {
        lastError = err as Error;
        if (attempt === options.maxRetries) break;

        const delay = options.baseDelayMs * Math.pow(2, attempt) + Math.random() * 100;
        logger.warn({ attempt, delay, err: lastError.message }, 'Retrying operation');
        await sleep(delay);
      }
    }
    throw lastError;
  }

  // Usage
  const user = await withRetry(() => db.user.findUnique({ where: { id: userId } }));
  ```

- **Circuit Breaker Pattern:** Prevent cascading failures by stopping calls to a failing dependency once error thresholds are exceeded.

  ```typescript
  enum CircuitState { CLOSED, OPEN, HALF_OPEN }

  class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount = 0;
    private lastFailureTime = 0;
    private readonly threshold = 5;
    private readonly resetTimeoutMs = 30000;

    async call<T>(fn: () => Promise<T>): Promise<T> {
      if (this.state === CircuitState.OPEN) {
        if (Date.now() - this.lastFailureTime > this.resetTimeoutMs) {
          this.state = CircuitState.HALF_OPEN;
        } else {
          throw new CircuitBreakerOpenError('Service unavailable — circuit breaker open');
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

  ```typescript
  async function fetchWithTimeout<T>(url: string, timeoutMs = 5000): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new HttpError(response.status, response.statusText);
      return response.json() as Promise<T>;
    } finally {
      clearTimeout(timeout);
    }
  }
  ```
