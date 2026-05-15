---
name: security-and-observability
description: Detailed reference for security best practices, observability (logging, metrics, health), and API versioning.
---

### 8. Security Best Practices

- **Input Validation:** Validate and sanitize all inputs at the API boundary. Never trust client data.

  ```js
  // Using a schema validation library (e.g. Zod, Joi, Valibot)

  const createUserSchema = z.object({
    email: z.string().email(),
    name: z.string().min(1).max(100),
    age: z.number().int().positive().optional(),
    role: z.enum(['user', 'admin']).default('user'),
  });

  // Middleware — validate request body against schema
  function validate(schema) {
    return (request, sendResponse, next) => {
      const result = schema.safeParse(request.body);
      if (!result.success) {
        throw new ValidationError(result.error.issues);
      }
      request.body = result.data; // Use parsed (and coerced) data
      next();
    };
  }

  // Route — framework-agnostic
  // POST /users with validate(createUserSchema) middleware
  ```

- **Authentication & Authorization:**

  ```js
  // Authentication middleware — verify token, attach user to request
  async function authenticate(request, sendResponse, next) {
    const token = request.headers.authorization?.replace('Bearer ', '');
    if (!token) throw new UnauthorizedError('Missing authentication token');

    try {
      const payload = jwt.verify(token, process.env.JWT_SECRET);
      request.user = { id: payload.sub, role: payload.role };
      next();
    } catch {
      throw new UnauthorizedError('Invalid or expired token');
    }
  }

  // Authorization middleware — check user role/permissions
  function requireRole(...roles) {
    return (request, sendResponse, next) => {
      if (!request.user || !roles.includes(request.user.role)) {
        throw new ForbiddenError('Insufficient permissions');
      }
      next();
    };
  }

  // Route-level usage
  // DELETE /users/:id with authenticate, requireRole('admin')
  ```

- **Rate Limiting:** Protect APIs from abuse. Use token bucket or sliding window algorithms.

  ```js
  // Sliding window rate limiter (stored in distributed cache for cross-instance rate limiting)
  async function rateLimit(key, limit, windowMs) {
    const now = Date.now();
    const windowStart = now - windowMs;

    // Remove old entries outside the window
    await cache.zRemRangeByScore(key, 0, windowStart);
    const count = await cache.zCard(key);

    if (count >= limit) {
      const oldest = await cache.zRange(key, 0, 0);
      const retryAfter = oldest.length > 0
        ? Math.ceil((parseInt(oldest[0]) + windowMs - now) / 1000)
        : Math.ceil(windowMs / 1000);
      throw new RateLimitedError(retryAfter);
    }

    await cache.zAdd(key, { score: now, value: `${now}-${crypto.randomUUID()}` });
    await cache.expire(key, Math.ceil(windowMs / 1000));
  }

  // Middleware
  async function rateLimitMiddleware(request, sendResponse, next) {
    const key = `ratelimit:api:${request.ip}`;
    await rateLimit(key, 100, 60000); // 100 requests per minute
    next();
  }
  ```

- **Secrets Management:** Never hardcode secrets. Use environment variables injected by the deployment platform or a secrets manager (Vault, AWS Secrets Manager).

  ```js
  // GOOD: Read from environment
  const config = {
    dbUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET,
    cacheUrl: process.env.CACHE_URL,
  };

  if (!config.dbUrl || !config.jwtSecret) {
    throw new Error('Missing required environment variables');
  }

  // BAD: Hardcoded secrets
  const jwtSecret = 'supersecretkey123!'; // ❌ Never do this
  ```

### 9. Observability

Backend services must be observable: logs, metrics, and traces must be available for debugging and monitoring.

- **Structured Logging:** Use structured loggers with consistent fields. Never use raw `console.log`.

  ```js
  const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    formatters: { level: (label) => ({ severity: label.toUpperCase() }) },
    redact: ['request.headers.authorization', 'request.body.password'], // Never log secrets
  });

  // Usage throughout the codebase
  logger.info({ userId: 'usr_123', action: 'order.created', orderId: 'ord_456' }, 'Order created successfully');

  logger.error({ err, orderId: 'ord_456' }, 'Failed to process payment for order');

  // Request-scoped logger (attach requestId to every log line)
  function attachRequestLogger(request) {
    request.logger = logger.child({ requestId: request.id, path: request.path, method: request.method });
  }
  ```

- **Health Check Endpoints:**

  ```js
  // GET /health — liveness probe (is the process alive?)
  function handleHealth(request, sendResponse) {
    sendResponse(200, { status: 'ok', timestamp: new Date().toISOString() });
  }

  // GET /health/ready — readiness probe (can the service accept traffic?)
  async function handleReadiness(request, sendResponse) {
    const checks = {
      database: await checkDatabase(),
      cache: await checkCache(),
      upstream: await checkUpstreamService(),
    };

    const allHealthy = Object.values(checks).every((c) => c.status === 'up');
    const statusCode = allHealthy ? 200 : 503;

    sendResponse(statusCode, {
      status: allHealthy ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    });
  }

  async function checkDatabase() {
    try {
      await db.query('SELECT 1');
      return { status: 'up' };
    } catch (err) {
      return { status: 'down', error: err.message };
    }
  }
  ```

- **Metrics Collection:** Expose metrics for monitoring systems (Prometheus, Datadog, etc.).

  ```js
  // Example using a metrics library (e.g. prom-client)
  const metricsRegistry = createMetricsRegistry();

  const httpRequestDuration = new metricsRegistry.Histogram({
    name: 'http_request_duration_ms',
    help: 'Duration of HTTP requests in ms',
    labelNames: ['method', 'route', 'status_code'],
    buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000],
  });

  const activeRequests = new metricsRegistry.Gauge({
    name: 'http_requests_active',
    help: 'Number of currently active HTTP requests',
  });

  const dbQueryDuration = new metricsRegistry.Histogram({
    name: 'db_query_duration_ms',
    help: 'Duration of database queries in ms',
    labelNames: ['query_name'],
    buckets: [1, 5, 10, 25, 50, 100, 250, 500],
  });

  // Middleware to record request metrics
  function recordMetrics(request, sendResponse, next) {
    const end = httpRequestDuration.startTimer();
    activeRequests.inc();
    request.onFinish = () => {
      end({ method: request.method, route: request.route || 'unknown', status_code: request.statusCode });
      activeRequests.dec();
    };
    next();
  }

  // Metrics endpoint
  async function handleMetrics(request, sendResponse) {
    sendResponse(200, await metricsRegistry.metrics(), {
      'Content-Type': metricsRegistry.contentType,
    });
  }
  ```

### 10. API Versioning & Migration

APIs evolve over time. Versioning strategies ensure existing clients are not broken.

- **URL Path Versioning (recommended for most cases):**

  ```js
  // Routes are scoped by version
  // /api/v1/users → handled by v1 handlers
  // /api/v2/users → handled by v2 handlers

  const v1Handlers = {
    listUsers: (req, res) => { /* v1 response format */ },
    createUser: (req, res) => { /* v1 create logic */ },
  };

  const v2Handlers = {
    listUsers: (req, res) => { /* v2 response format — updated */ },
    createUser: (req, res) => { /* v2 create logic — new required fields */ },
  };
  ```

- **Header Versioning (alternative — keeps URLs clean but requires client cooperation):**

  ```js
  // Client sends: Accept: application/vnd.myapi.v2+json
  function resolveApiVersion(request) {
    const accept = request.headers.accept || '';
    const match = accept.match(/application\/vnd\.myapi\.v(\d+)\+json/);
    return match ? parseInt(match[1]) : 1;
  }

  // Route handlers check the version
  function handleUserList(request, sendResponse) {
    const version = resolveApiVersion(request);
    if (version >= 2) {
      return handleV2UserList(request, sendResponse);
    }
    return handleV1UserList(request, sendResponse);
  }
  ```

- **Backward Compatibility Rules:**

  1. Never remove a field from a response — mark it as `deprecated` instead and remove it in a future major version.
  2. Never make an optional field required in the same version — add it as optional first, then require it in the next version.
  3. Support old request formats for at least one major version cycle.
  4. Use the `Sunset` and `Deprecation` HTTP headers to inform clients of upcoming changes.

  ```js
  // Response with deprecated field
  function sendUserResponse(sendResponse, user) {
    sendResponse(200, {
      success: true,
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        full_name: user.name, // Deprecated — same as 'name', kept for backward compat
      },
    }, {
      'Deprecation': 'true',
      'Sunset': 'Sat, 01 Nov 2026 00:00:00 GMT',
      'Link': '</api/v2/users>; rel="successor-version"',
    });
  }
  ```
