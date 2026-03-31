-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NotificationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "senderClientId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    CONSTRAINT "NotificationJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NotificationJob" ("createdAt", "eventId", "id", "payload", "processedAt", "senderClientId", "type") SELECT "createdAt", "eventId", "id", "payload", "processedAt", "senderClientId", "type" FROM "NotificationJob";
DROP TABLE "NotificationJob";
ALTER TABLE "new_NotificationJob" RENAME TO "NotificationJob";
CREATE INDEX "NotificationJob_processedAt_createdAt_idx" ON "NotificationJob"("processedAt", "createdAt");
CREATE INDEX "NotificationJob_eventId_idx" ON "NotificationJob"("eventId");
CREATE TABLE "new_PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "clientId" TEXT NOT NULL DEFAULT '',
    "userId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PushSubscription" ("auth", "clientId", "createdAt", "endpoint", "eventId", "id", "locale", "p256dh", "userId") SELECT "auth", "clientId", "createdAt", "endpoint", "eventId", "id", "locale", "p256dh", "userId" FROM "PushSubscription";
DROP TABLE "PushSubscription";
ALTER TABLE "new_PushSubscription" RENAME TO "PushSubscription";
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
CREATE UNIQUE INDEX "PushSubscription_eventId_endpoint_key" ON "PushSubscription"("eventId", "endpoint");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
