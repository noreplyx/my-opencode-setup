---
name: microservice-patterns
description: Detailed reference for microservice readiness, horizontal scaling, and API design & contracts with code examples.
---

## 1. Microservice Readiness

Design every service as if it will be extracted into its own deployment unit. No implicit assumptions about in-process shared state with other services.

- **Independent Deployability:** A service must be deployable without requiring simultaneous changes to other services. Use feature flags to gate new behavior instead of coordinating deployments.

  ```js
  // GOOD: Feature-flagged behavior
  const featureFlags = await getFeatureFlags(tenantId);
  if (featureFlags.isEnabled('new-checkout-flow')) {
    return handleNewCheckout(request);
  }
  return handleLegacyCheckout(request);

  // BAD: Coordinated deploy required
  // Service A expects Service B to have a new endpoint — both must deploy together
  ```

- **Loose Coupling via Asynchronous Communication:** Prefer events and message queues over synchronous HTTP calls for cross-service workflows. Use a message broker to decouple producers from consumers.

  ```js
  // Event producer — Order Service
  async function createOrder(cart) {
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
  eventBus.subscribe('order.created', async (event) => {
    for (const item of event.items) {
      await inventoryRepository.decrementStock(item.sku, item.quantity);
    }
  });
  ```

- **API Gateway Pattern:** Route external client requests through a single gateway that handles authentication, rate limiting, request transformation, and routing to internal services.

  ```js
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

- **Statelessness:** Never store session state or user context in process memory. Use external stores (e.g. Redis, database) for any state that must survive a restart or be shared across instances.

  ```js
  // GOOD: Stateless — session stored in external cache
  async function getSession(sessionId) {
    return cache.get(`session:${sessionId}`);
  }

  async function setSession(sessionId, data) {
    await cache.set(`session:${sessionId}`, data, { ttl: 3600 });
  }

  // BAD: Stateful — session in local memory, lost on restart / breaks with multiple instances
  const sessionStore = new Map();
  function getSession(sessionId) {
    return sessionStore.get(sessionId);
  }
  ```

- **Shared-Nothing Architecture:** Each instance operates independently. No file system sharing, no local mutexes, no in-memory caches that assume a single process.

  ```js
  // GOOD: Distributed lock via cache (works across instances)
  async function processPayment(orderId) {
    const lockKey = `lock:payment:${orderId}`;
    const acquired = await cache.setNX(lockKey, 'locked', { ttl: 5000 });
    if (!acquired) {
      throw new ConflictError('Payment already being processed');
    }
    try {
      await paymentGateway.charge(orderId);
    } finally {
      await cache.del(lockKey);
    }
  }

  // BAD: Local lock — useless when 10 instances are running
  const paymentLocks = new Set();
  ```

- **Idempotent Handlers:** Message consumers and API handlers must produce the same result when invoked multiple times with the same input. Use idempotency keys for payment, order, and notification workflows.

  ```js
  async function handlePaymentWebhook(event) {
    // Check idempotency store before processing
    const alreadyProcessed = await cache.get(`idempotency:payment:${event.id}`);
    if (alreadyProcessed) {
      logger.info(`Payment ${event.id} already processed, skipping`);
      return;
    }
    await db.transaction(async (tx) => {
      await tx.orders.update({ paymentId: event.id, status: 'paid' });
      await cache.set(`idempotency:payment:${event.id}`, 'done', { ttl: 86400 });
    });
  }
  ```

- **Graceful Shutdown:** Handle SIGTERM/SIGINT to drain active requests, stop accepting new ones, and close connections cleanly.

  ```js
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received — draining connections');
    await server.close();
    logger.info('HTTP server closed');
    await db.disconnect();
    await cache.disconnect();
    process.exit(0);
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

  ```js
  // Success response
  // { success: true, data: { ... }, meta: { requestId, timestamp } }

  // Error response
  // { success: false, error: { code, message, details? }, meta: { requestId, timestamp } }

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

  ```js
  // Request: GET /api/v1/users?limit=20&cursor=eyJsYXN0SWQiOiAidXNyXzEyMyJ9
  // Response
  {
    "success": true,
    "data": [
      { "id": "usr_124", "name": "Alice" },
      { "id": "usr_125", "name": "Bob" }
    ],
    "pagination": {
      "nextCursor": "eyJsYXN0SWQiOiAidXNyXzEyNSJ9",
      "hasMore": true,
      "limit": 20
    }
  }

  // Handler implementation (framework-agnostic)
  async function listUsers(query, sendResponse) {
    const limit = Math.min(parseInt(query.limit) || 20, 100);
    const cursor = query.cursor;

    const decodedCursor = cursor ? decodeCursor(cursor) : null;
    const users = await userRepository.findPaginated(limit + 1, decodedCursor?.lastId);

    const hasMore = users.length > limit;
    const data = hasMore ? users.slice(0, limit) : users;

    sendResponse({
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

  ```js
  // Middleware concept (framework-agnostic)
  async function idempotencyHandler(request, response) {
    if (['POST', 'PATCH', 'PUT'].includes(request.method)) {
      const key = request.headers['idempotency-key'];
      if (!key) return sendError(response, 400, 'Idempotency-Key header required');

      const existing = await cache.get(`idempotency:${key}`);
      if (existing) {
        return sendResponse(response, 200, JSON.parse(existing));
      }

      request.idempotencyKey = key;
    }
  }

  // After successful processing, store the response
  async function storeIdempotentResponse(key, responseData, ttl = 86400) {
    return cache.set(`idempotency:${key}`, JSON.stringify(responseData), { ttl });
  }
  ```
