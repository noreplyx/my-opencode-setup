# Notification System

## Overview
Build an in-app notification system that allows users to receive and manage notifications.

## Requirements

### Domain Model
```typescript
interface Notification {
  id: string;
  userId: string;
  type: "mention" | "like" | "follow" | "system";
  title: string;
  body: string;
  read: boolean;
  createdAt: Date;
}
```

### Service
- `NotificationService` class with methods:
  - `sendNotification(userId, type, title, body)` — Create and store a notification
  - `getNotifications(userId)` — Get paginated list for a user
  - `markAsRead(notificationId)` — Mark single notification as read
  - `markAllAsRead(userId)` — Mark all notifications as read for a user
  - `getUnreadCount(userId)` — Return count of unread notifications

### Validation & Error Handling
- `sendNotification` must validate all input fields
- `getNotifications` must validate pagination params
- All methods that write data must handle database errors

### Files to Create
- `src/services/notification-service.ts` — The main service
- `src/routes/notification-routes.ts` — Express routes
- `src/types/notification.ts` — Type definitions

### API Routes (Express)
- `GET /api/notifications` — Get notifications for current user (with pagination query params)
- `POST /api/notifications` — Send a notification (admin only)
- `PATCH /api/notifications/:id/read` — Mark as read
- `PATCH /api/notifications/read-all` — Mark all as read
- `GET /api/notifications/unread-count` — Get unread count
