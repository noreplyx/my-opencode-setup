# User Profile Service

## Overview
Create a user profile management service with CRUD operations and avatar upload support.

## Requirements

### API Endpoints
- `GET /api/users/:id` — Get user profile by ID
- `PUT /api/users/:id` — Update user profile fields
- `POST /api/users/:id/avatar` — Upload user avatar image

### Domain Model
```typescript
interface UserProfile {
  id: string;
  displayName: string;
  bio: string;
  avatarUrl: string | null;
  updatedAt: Date;
}
```

### Service Layer
- `UserProfileService` class with methods: `getProfile`, `updateProfile`, `uploadAvatar`
- Each method must validate input before processing
- Each method must handle database errors gracefully with try-catch

### File Structure
New files to create:
- `src/services/user-profile-service.ts` — The service class
- `src/routes/user-profile-routes.ts` — Express route handlers
- `src/types/user-profile.ts` — Type definitions

### Validation Rules
- `displayName`: required, 1-100 chars
- `bio`: optional, max 500 chars
- Avatar upload: accept only JPEG/PNG, max 5MB
