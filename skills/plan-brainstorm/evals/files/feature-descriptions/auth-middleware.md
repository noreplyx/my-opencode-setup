# Authentication Middleware

## Overview
Add JWT-based authentication middleware to protect existing API routes.

## Requirements

### Middleware
- `authenticate` middleware function that reads JWT from `Authorization: Bearer <token>` header
- On success: attach decoded user payload to `req.user`
- On failure: return 401 with error message

### Token Validation
- Verify JWT signature using `jsonwebtoken` library
- Check token expiration
- Return appropriate error messages for expired vs invalid tokens

### Implementation
Modify existing file:
- `src/middleware/auth.ts` — Add authenticate middleware

New files:
- `src/types/auth.ts` — Define `AuthPayload` interface with `userId` and `role` fields

### File Structure
- `src/middleware/auth.ts` — Must export `authenticate` function
- `src/types/auth.ts` — Must export `AuthPayload` type

### Behavioral Requirements
- `authenticate` must handle errors (invalid/expired token) gracefully and return appropriate HTTP responses
- `authenticate` must validate the Authorization header format before decoding
