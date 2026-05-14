---
name: security-and-observability
description: Detailed reference for security best practices, observability (logging, metrics, health), and API versioning.
---

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
