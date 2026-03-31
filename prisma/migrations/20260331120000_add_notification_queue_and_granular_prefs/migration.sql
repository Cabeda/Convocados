-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN "userId" TEXT;

-- CreateTable
CREATE TABLE "NotificationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "senderClientId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NotificationPreferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "gameInviteEmail" BOOLEAN NOT NULL DEFAULT true,
    "gameInvitePush" BOOLEAN NOT NULL DEFAULT true,
    "gameReminderEmail" BOOLEAN NOT NULL DEFAULT true,
    "gameReminderPush" BOOLEAN NOT NULL DEFAULT true,
    "playerActivityPush" BOOLEAN NOT NULL DEFAULT true,
    "eventDetailsPush" BOOLEAN NOT NULL DEFAULT true,
    "weeklySummaryEmail" BOOLEAN NOT NULL DEFAULT false,
    "paymentReminderEmail" BOOLEAN NOT NULL DEFAULT true,
    "paymentReminderPush" BOOLEAN NOT NULL DEFAULT true,
    "reminder24h" BOOLEAN NOT NULL DEFAULT true,
    "reminder2h" BOOLEAN NOT NULL DEFAULT true,
    "reminder1h" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NotificationPreferences" ("createdAt", "emailEnabled", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail") SELECT "createdAt", "emailEnabled", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail" FROM "NotificationPreferences";
DROP TABLE "NotificationPreferences";
ALTER TABLE "new_NotificationPreferences" RENAME TO "NotificationPreferences";
CREATE UNIQUE INDEX "NotificationPreferences_userId_key" ON "NotificationPreferences"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "NotificationJob_processedAt_createdAt_idx" ON "NotificationJob"("processedAt", "createdAt");

-- CreateIndex
CREATE INDEX "NotificationJob_eventId_idx" ON "NotificationJob"("eventId");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
