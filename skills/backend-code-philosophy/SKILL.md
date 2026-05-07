---
name: backend-code-philosophy
description: Use this skill when planning or implementing backend code to ensure adherence to microservice readiness and horizontal scaling.
---

# Backend Code Philosophy

This skill supplements the general `code-philosophy` skill by providing backend-specific concerns: microservice architecture, horizontal scaling, API design, data access, caching, resilience, security, observability, and testing. Use it alongside `code-philosophy` when writing or reviewing any backend service code.

---

## Core Principles

### 1. Microservice Readiness

Design every service as if it will be extracted into its own deployment unit. No implicit assumptions about in-process shared state with other services.

- **Independent Deployability:** A service must be deployable without requiring simultaneous changes to other services. Use feature flags to gate new behavior instead of coordinating deployments.

  ```typescript
  // GOOD: Feature-flagged behavior
  const featureFlags = await getFeatureFlags(tenantId);
  if (featureFlags.isEnabled('new-checkout-flow')) {
    return handleNewCheckout(request);
  }
  return handleLegacyCheckout(request);

  // BAD: Coordinated deploy required
  // Service A expects Service B to have a new endpoint — both must deploy together
  ```

- **Loose Coupling via Asynchronous Communication:** Prefer events and message queues over synchronous HTTP calls for cross-service workflows. Use a message broker (RabbitMQ, Kafka, SQS) to decouple producers from consumers.

  ```typescript
  // Event producer — Order Service
  async function createOrder(cart: Cart): Promise<Order> {
    const order = await db.orders.create({ userId: cart.userId, items: cart.items });
    await eventBus.publish('order.created', {
      orderId: order.id,
      userId: order.userId,
      total: order.total,
      timestamp: new Date().toISOString(),
    });
    return order;
  }

  // Event consumer — Inventory Service (separate deployment, separate codebase)
  eventBus.subscribe('order.created', async (event: OrderCreatedEvent) => {
    for (const item of event.items) {
      await inventoryRepository.decrementStock(item.sku, item.quantity);
    }
  });
  ```

- **API Gateway Pattern:** Route external client requests through a single gateway that handles authentication, rate limiting, request transformation, and routing to internal services.

  ```typescript
  // API Gateway route configuration
  const gatewayRoutes = [
    { path: '/api/v1/users', target: 'http://user-service:3001', methods: ['GET', 'POST'] },
    { path: '/api/v1/orders', target: 'http://order-service:3002', methods: ['GET', 'POST'] },
    { path: '/api/v1/inventory', target: 'http://inventory-service:3003', methods: ['GET'] },
  ];

  // Gateway middleware adds auth context before routing
  gateway.use(async (req, res, next) => {
    const user = await authenticateRequest(req);
    req.headers['x-user-id'] = user.id;
    req.headers['x-tenant-id'] = user.tenantId;
    next();
  });
  ```

- **Service Discovery & Health Checks:** Each service must expose a `/health` endpoint. Use service registry (Consul, Kubernetes DNS) for dynamic endpoint resolution instead of hardcoded URLs.

### 2. Horizontal Scaling

Services must scale horizontally by adding more instances, not by making individual instances larger (vertical scaling).

- **Statelessness:** Never store session state or user context in process memory. Use external stores (Redis, database) for any state that must survive a restart or be shared across instances.

  ```typescript
  // GOOD: Stateless — session stored in external cache
  async function getSession(sessionId: string): Promise<Session | null> {
    return redis.get(`session:${sessionId}`);
  }

  async function setSession(sessionId: string, data: Session): Promise<void> {
    await redis.set(`session:${sessionId}`, data, { ttl: 3600 });
  }

  // BAD: Stateful — session in local memory, lost on restart / breaks with multiple instances
  const sessionStore = new Map<string, Session>();
  function getSession(sessionId: string): Session | undefined {
    return sessionStore.get(sessionId);
  }
  ```

- **Shared-Nothing Architecture:** Each instance operates independently. No file system sharing, no local mutexes, no in-memory caches that assume a single process.

  ```typescript
  // GOOD: Distributed lock via Redis (works across instances)
  async function processPayment(orderId: string): Promise<void> {
    const lockKey = `lock:payment:${orderId}`;
    const acquired = await redis.setNX(lockKey, 'locked', { ttl: 5000 });
    if (!acquired) {
      throw new ConflictError('Payment already being processed');
    }
    try {
      await paymentGateway.charge(orderId);
    } finally {
      await redis.del(lockKey);
    }
  }

  // BAD: Local lock — useless when 10 instances are running
  const paymentLocks = new Set<string>();
  ```

- **Idempotent Handlers:** Message consumers and API handlers must produce the same result when invoked multiple times with the same input. Use idempotency keys for payment, order, and notification workflows.

  ```typescript
  async function handlePaymentWebhook(event: PaymentEvent): Promise<void> {
    // Check idempotency store before processing
    const alreadyProcessed = await redis.get(`idempotency:payment:${event.id}`);
    if (alreadyProcessed) {
      logger.info(`Payment ${event.id} already processed, skipping`);
      return;
    }
    await db.transaction(async (tx) => {
      await tx.orders.update({ paymentId: event.id, status: 'paid' });
      await redis.set(`idempotency:payment:${event.id}`, 'done', { ttl: 86400 });
    });
  }
  ```

- **Graceful Shutdown:** Handle SIGTERM/SIGINT to drain active requests, stop accepting new ones, and close connections cleanly.

  ```typescript
  const server = app.listen(port);
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received — draining connections');
    server.close(() => {
      logger.info('HTTP server closed');
      db.disconnect();
      redis.disconnect();
      process.exit(0);
    });
  });
  ```

### 3. API Design & Contracts

Define clear, consistent contracts between services and between the service and its clients.

- **RESTful Conventions:** Use standard HTTP methods with consistent resource naming (plural nouns, kebab-case for multi-word resources).

  ```
  GET    /api/v1/users                  # List users
  POST   /api/v1/users                  # Create user
  GET    /api/v1/users/:id              # Get single user
  PATCH  /api/v1/users/:id              # Partial update
  DELETE /api/v1/users/:id              # Soft-delete user
  GET    /api/v1/users/:id/orders       # Sub-resource collection
  ```

- **Request/Response Envelope:** All responses follow a consistent structure. Never return raw arrays or unexpected shapes.

  ```typescript
  // Success response
  interface ApiResponse<T> {
    success: true;
    data: T;
    meta?: {
      requestId: string;
      timestamp: string;
    };
  }

  // Error response
  interface ApiError {
    success: false;
    error: {
      code: string;            // e.g., 'VALIDATION_ERROR', 'NOT_FOUND', 'RATE_LIMITED'
      message: string;          // Human-readable description
      details?: unknown;        // Field-level errors (for validation failures)
    };
    meta: {
      requestId: string;
      timestamp: string;
    };
  }

  // Example: GET /api/v1/users/:id
  // 200 Response
  {
    "success": true,
    "data": {
      "id": "usr_abc123",
      "email": "user@example.com",
      "name": "Jane Doe",
      "createdAt": "2025-01-15T10:30:00Z"
    },
    "meta": {
      "requestId": "req_xyz789",
      "timestamp": "2025-06-01T12:00:00Z"
    }
  }

  // 422 Response (validation failure)
  {
    "success": false,
    "error": {
      "code": "VALIDATION_ERROR",
      "message": "Request validation failed",
      "details": [
        { "field": "email", "message": "Must be a valid email address" },
        { "field": "age", "message": "Must be a positive integer" }
      ]
    },
    "meta": {
      "requestId": "req_xyz789",
      "timestamp": "2025-06-01T12:00:00Z"
    }
  }
  ```

- **Pagination:** Use cursor-based pagination for large, dynamic datasets. Support `limit`, `cursor`, and optional `sort` parameters.

  ```typescript
  // Request: GET /api/v1/users?limit=20&cursor=eyJsYXN0SWQiOiAidXNyXzEyMyJ9
  // Response
  {
    "success": true,
    "data": [
      { "id": "usr_124", "name": "Alice", ... },
      { "id": "usr_125", "name": "Bob", ... }
    ],
    "pagination": {
      "nextCursor": "eyJsYXN0SWQiOiAidXNyXzEyNSJ9",
      "hasMore": true,
      "limit": 20
    }
  }

  // Handler implementation
  async function listUsers(req: Request, res: Response): Promise<void> {
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const cursor = req.query.cursor as string | undefined;

    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const users = await userRepository.findPaginated(limit + 1, decodedCursor?.lastId);

    const hasMore = users.length > limit;
    const data = hasMore ? users.slice(0, limit) : users;

    res.json({
      success: true,
      data,
      pagination: {
        nextCursor: hasMore ? encodeCursor({ lastId: data[data.length - 1].id }) : null,
        hasMore,
        limit,
      },
    });
  }
  ```

- **Idempotency Key Pattern:** For mutating endpoints (especially payments, orders), clients send an `Idempotency-Key` header. The server deduplicates requests with the same key within a TTL window.

  ```typescript
  // Middleware
  async function idempotencyMiddleware(req: Request, res: Response, next: NextFunction) {
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      const key = req.headers['idempotency-key'] as string;
      if (!key) return next(new BadRequestError('Idempotency-Key header required'));

      const existing = await redis.get(`idempotency:${key}`);
      if (existing) {
        return res.status(200).json(JSON.parse(existing));
      }

      res.locals.idempotencyKey = key;
    }
    next();
  }

  // After successful processing, store the response
  function storeIdempotentResponse(key: string, response: unknown, ttl = 86400): Promise<void> {
    return redis.set(`idempotency:${key}`, JSON.stringify(response), { ttl });
  }
  ```

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

---

## New Sections

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

### 8. Security Best Practices

- **Input Validation:** Validate and sanitize all inputs at the API boundary. Never trust client data.

  ```typescript
  import { z } from 'zod'; // Schema validation library

  const createUserSchema = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(100),
    age: z.number().int().positive().optional(),
    role: z.enum(['user', 'admin']).default('user'),
  });

  type CreateUserInput = z.infer<typeof createUserSchema>;

  // Middleware
  function validate(schema: z.ZodSchema) {
    return (req: Request, res: Response, next: NextFunction) => {
      const result = schema.safeParse(req.body);
      if (!result.success) {
        throw new ValidationError(result.error.issues);
      }
      req.body = result.data; // Use parsed (and coerced) data
      next();
    };
  }

  // Route
  router.post('/users', validate(createUserSchema), userController.create);
  ```

- **Authentication & Authorization:**

  ```typescript
  // Authentication middleware — verify token, attach user to request
  async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new UnauthorizedError('Missing authentication token');

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET!);
      req.user = { id: payload.sub, role: payload.role };
      next();
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  // Authorization middleware — check user role/permissions
  function requireRole(...roles: string[]) {
    return (req: Request, _res: Response, next: NextFunction): void => {
      if (!req.user || !roles.includes(req.user.role)) {
        throw new ForbiddenError('Insufficient permissions');
      }
      next();
    };
  }

  // Route-level usage
  router.delete('/users/:id', authenticate, requireRole('admin'), userController.delete);
  ```

- **Rate Limiting:** Protect APIs from abuse. Use token bucket or sliding window algorithms.

  ```typescript
  // Sliding window rate limiter (stored in Redis for distributed rate limiting)
  async function rateLimit(key: string, limit: number, windowMs: number): Promise<void> {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Remove old entries outside the window
    await redis.zRemRangeByScore(key, 0, windowStart);
    const count = await redis.zCard(key);

    if (count >= limit) {
      const oldest = await redis.zRange(key, 0, 0);
      const retryAfter = oldest.length > 0 ? Math.ceil((parseInt(oldest[0].value) + windowMs - now) / 1000) : windowMs / 1000;
      throw new RateLimitedError(retryAfter);
    }

    await redis.zAdd(key, { score: now, value: `${now}-${crypto.randomUUID()}` });
    await redis.expire(key, Math.ceil(windowMs / 1000));
  }

  // Middleware
  async function rateLimitMiddleware(req: Request, _res: Response, next: NextFunction): Promise<void> {
    const key = `ratelimit:api:${req.ip}`;
    await rateLimit(key, 100, 60000); // 100 requests per minute
    next();
  }
  ```

- **Secrets Management:** Never hardcode secrets. Use environment variables injected by the deployment platform or a secrets manager (Vault, AWS Secrets Manager).

  ```typescript
  // GOOD: Read from environment
  const config = {
    dbUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    redisUrl: process.env.REDIS_URL,
  };

  if (!config.dbUrl || !config.jwtSecret) {
    throw new Error('Missing required environment variables');
  }

  // BAD: Hardcoded secrets
  const jwtSecret = 'supersecretkey123!'; // ❌ Never do this
  ```

### 9. Observability

Backend services must be observable: logs, metrics, and traces must be available for debugging and monitoring.

- **Structured Logging:** Use structured loggers (Pino, Winston) with consistent fields. Never use `console.log`.

  ```typescript
  import pino from 'pino';

  const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
      level(label: string) {
        return { severity: label.toUpperCase() };
      },
    },
    redact: ['req.headers.authorization', 'req.body.password', 'req.body.ssn'], // Never log secrets
  });

  // Usage throughout the codebase
  logger.info({ userId: 'usr_123', action: 'order.created', orderId: 'ord_456' }, 'Order created successfully');

  logger.error({ err, orderId: 'ord_456' }, 'Failed to process payment for order');

  // Request-scoped logger (attach requestId to every log line)
  app.use((req, res, next) => {
    req.logger = logger.child({ requestId: req.id, path: req.path, method: req.method });
    next();
  });
  ```

- **Health Check Endpoints:**

  ```typescript
  // GET /health — liveness probe (is the process alive?)
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // GET /health/ready — readiness probe (can the service accept traffic?)
  app.get('/health/ready', async (_req, res) => {
    const checks = {
      database: await checkDatabase(),
      redis: await checkRedis(),
      upstream: await checkUpstreamService(),
    };

    const allHealthy = Object.values(checks).every((c) => c.status === 'up');
    const statusCode = allHealthy ? 200 : 503;

    res.status(statusCode).json({
      status: allHealthy ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  async function checkDatabase(): Promise<HealthCheckResult> {
    try {
      await db.$queryRaw`SELECT 1`;
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', error: (err as Error).message };
    }
  }
  ```

- **Metrics Collection:** Expose metrics for monitoring systems (Prometheus, Datadog, etc.).

  ```typescript
  // Example using prom-client
  import client from 'prom-client';

  const httpRequestDuration = new client.Histogram({
    name: 'http_request_duration_ms',
    help: 'Duration of HTTP requests in ms',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  });

  const activeRequests = new client.Gauge({
    name: 'http_requests_active',
    help: 'Number of currently active HTTP requests',
  });

  const dbQueryDuration = new client.Histogram({
    name: 'db_query_duration_ms',
    help: 'Duration of database queries in ms',
    labelNames: ['query_name'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  });

  // Middleware to record request metrics
  app.use((req, res, next) => {
    const end = httpRequestDuration.startTimer();
    activeRequests.inc();
    res.on('finish', () => {
      end({ method: req.method, route: req.route?.path || 'unknown', status_code: res.statusCode });
      activeRequests.dec();
    });
    next();
  });

  // Metrics endpoint
  app.get('/metrics', async (_req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
  });
  ```

### 10. API Versioning & Migration

APIs evolve over time. Versioning strategies ensure existing clients are not broken.

- **URL Path Versioning (recommended for most cases):**

  ```typescript
  // Routes are scoped by version
  const v1Router = Router();
  v1Router.get('/users', v1UserController.list);
  v1Router.post('/users', v1UserController.create);

  const v2Router = Router();
  v2Router.get('/users', v2UserController.list);      // Updated response format
  v2Router.post('/users', v2UserController.create);    // New required fields

  app.use('/api/v1', v1Router);
  app.use('/api/v2', v2Router);
  ```

- **Header Versioning (alternative — keeps URLs clean but requires client cooperation):**

  ```typescript
  // Client sends: Accept: application/vnd.myapi.v2+json
  app.use((req, res, next) => {
    const accept = req.headers.accept || '';
    const match = accept.match(/application\/vnd\.myapi\.v(\d+)\+json/);
    req.apiVersion = match ? parseInt(match[1]) : 1;
    next();
  });

  // Route handlers check the version
  app.get('/users', (req, res) => {
    if (req.apiVersion >= 2) {
      return handleV2UserList(req, res);
    }
    return handleV1UserList(req, res);
  });
  ```

- **Backward Compatibility Rules:**

  1. Never remove a field from a response — mark it as `deprecated` instead and remove it in a future major version.
  2. Never make an optional field required in the same version — add it as optional first, then require it in the next version.
  3. Support old request formats for at least one major version cycle.
  4. Use the `Sunset` and `Deprecation` HTTP headers to inform clients of upcoming changes.

  ```typescript
  // Response with deprecated field
  res.set('Deprecation', 'true');
  res.set('Sunset', 'Sat, 01 Nov 2026 00:00:00 GMT');
  res.set('Link', '</api/v2/users>; rel="successor-version"');

  res.json({
    success: true,
    data: {
      id: 'usr_123',
      name: 'Jane Doe',
      email: 'jane@example.com',
      full_name: 'Jane Doe', // Deprecated — same as 'name', kept for backward compat
    },
  });
  ```

---

## Workflow: How to Apply This Skill

When asked to implement or review backend code, follow this process:

1. **Load the general `code-philosophy` skill** first for foundational clean code, SOLID, and architecture guidance.
2. **Load this `backend-code-philosophy` skill** for backend-specific concerns.
3. **Identify the concern type** from the task:
   - **New API endpoint** → Apply sections 3 (API Design), 8 (Security), 9 (Observability)
   - **New service/module** → Apply sections 1 (Microservice Readiness), 2 (Horizontal Scaling), 5 (Database)
   - **Performance optimization** → Apply section 4 (Caching), section 5 (Query Optimization)
   - **Resilience improvement** → Apply section 7 (Error Handling & Resilience)
   - **Adding tests** → Apply section 6 (Testing Strategy)
   - **Upgrading/versioning API** → Apply section 10 (API Versioning)
4. **Reference the code examples** as templates, adapting them to the project's existing patterns and tech stack.
5. **Verify** that the implementation follows both the general code philosophy (clean code, SOLID) and these backend-specific principles.
