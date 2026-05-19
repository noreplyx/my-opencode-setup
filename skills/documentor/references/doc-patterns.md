# Documentation Patterns Reference

## JSDoc Patterns by Code Type

### Function
```typescript
/**
 * Short description (one sentence, imperative mood).
 *
 * Longer description if needed. Explain non-obvious behavior.
 *
 * @param userId - The unique identifier of the user. Must be a valid UUID.
 * @param options - Optional configuration overrides.
 * @param options.includeInactive - Whether to include inactive records (default: false).
 * @returns The user profile object, or null if not found.
 * @throws {ValidationError} If `userId` is not a valid UUID.
 * @throws {DatabaseError} If the database query fails.
 * @example
 * ```typescript
 * const profile = await getUserProfile('abc-123');
 * // profile => { id: 'abc-123', name: 'Alice', active: true }
 * ```
 */
```

### Class
```typescript
/**
 * Manages user authentication flows including login, logout, and token refresh.
 *
 * Uses JWT-based authentication with refresh token rotation. Sessions are
 * tracked in Redis with TTL-based expiry. This class is NOT thread-safe.
 *
 * @example
 * ```typescript
 * const auth = new AuthService(tokenRepository, userRepository);
 * const session = await auth.login('alice@example.com', 'password');
 * ```
 */
export class AuthService {
  /**
   * Authenticates a user with email and password.
   *
   * Validates credentials against the user repository, then creates a new
   * session with access + refresh tokens. On success, rotates any existing
   * refresh tokens for the same user.
   *
   * @param email - User's email address (case-insensitive).
   * @param password - User's plaintext password.
   * @returns A session object with accessToken, refreshToken, and expiresAt.
   * @throws {AuthenticationError} If credentials are invalid.
   * @throws {RateLimitError} If too many login attempts from this IP.
   */
  async login(email: string, password: string): Promise<Session> { ... }
}
```

### Interface / Type
```typescript
/**
 * Configuration options for the rate limiter middleware.
 *
 * @see {@link createRateLimiter} for usage.
 */
export interface RateLimiterOptions {
  /** Time window in milliseconds (default: 60000). */
  windowMs: number;
  /** Maximum requests allowed within the window. */
  maxRequests: number;
  /** HTTP status code to return when rate limited (default: 429). */
  statusCode?: number;
}
```

### Barrel / Index File
```typescript
/**
 * @packageDocumentation
 * Public API for the user module.
 *
 * Export surface:
 * - {@link UserService} — CRUD operations for user accounts
 * - {@link UserController} — HTTP route handlers
 * - {@link User} — User entity type
 * - {@link CreateUserDto} — Input validation schema
 */

export { UserService } from './user.service';
export { UserController } from './user.controller';
export type { User, CreateUserDto } from './user.types';
```

### Route Handler (Express/Fastify)
```typescript
/**
 * POST /api/users
 *
 * Creates a new user account. Validates input with Zod schema,
 * checks for duplicate email, and returns the created user.
 *
 * @body {CreateUserDto} User registration data.
 * @returns 201 - User created successfully with user object.
 * @returns 400 - Validation error (invalid input).
 * @returns 409 - Email already registered.
 * @returns 500 - Internal server error.
 *
 * @example
 * ```typescript
 * // Request
 * POST /api/users
 * { "email": "alice@example.com", "name": "Alice" }
 *
 * // Response 201
 * { "id": "abc-123", "email": "alice@example.com", "name": "Alice" }
 * ```
 */
```

## README Section Templates

### New Feature
```markdown
### User Profile Management

Manage user profiles with full CRUD operations.

```typescript
import { UserService } from './services/user';

const service = new UserService();
const profile = await service.getProfile(userId);
```

**Available operations:**
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/users/:id` | Get user profile |
| POST | `/api/users` | Create new user |
| PUT | `/api/users/:id` | Update user profile |
| DELETE | `/api/users/:id` | Delete user account |

**Configuration:**
- `USER_CACHE_TTL` — Profile cache TTL in seconds (default: 300)
```

### Configuration Change
```markdown
### Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `USER_CACHE_TTL` | No | `300` | Profile cache TTL in seconds |
```

## Changelog Writing Guidelines

1. **One entry per logical change**, not per file
2. **Link to PRs/issues** where applicable
3. **Imperative mood**: "Add", "Fix", "Remove" (not "Added", "Fixed", "Removed")
4. **Group by type**: Added, Changed, Fixed, Deprecated, Removed, Security
5. **User-focused**: Describe what the user experiences, not internal refactors
6. **Security entries get CVE/GHSA IDs** when applicable

### Good vs Bad

| Good | Bad |
|------|-----|
| `Add user profile CRUD endpoints` | `Create UserController with 4 methods` |
| `Fix error when email contains + character` | `Fix validation regex in email parser` |
| `Remove deprecated `v1/users` endpoint` | `Delete userRoutes.ts` |

## When NOT to Document

- **Trivial internal refactors** — Renaming a private variable
- **Test files** — Tests are self-documenting (unless testing a public API contract)
- **Generated files** — `dist/`, `build/`, compiled output
- **Configuration that is self-evident** — `port: 3000` doesn't need a comment
- **Obvious getters/setters** — `get name()` doesn't need JSDoc if the name is clear
