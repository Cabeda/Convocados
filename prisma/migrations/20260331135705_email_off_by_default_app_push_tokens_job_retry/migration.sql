-- CreateTable
CREATE TABLE "AppPushToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppPushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_NotificationJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "senderClientId" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" DATETIME,
    CONSTRAINT "NotificationJob_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NotificationJob" ("createdAt", "eventId", "id", "payload", "processedAt", "senderClientId", "type") SELECT "createdAt", "eventId", "id", "payload", "processedAt", "senderClientId", "type" FROM "NotificationJob";
DROP TABLE "NotificationJob";
ALTER TABLE "new_NotificationJob" RENAME TO "NotificationJob";
CREATE INDEX "NotificationJob_processedAt_createdAt_idx" ON "NotificationJob"("processedAt", "createdAt");
CREATE INDEX "NotificationJob_eventId_idx" ON "NotificationJob"("eventId");
CREATE TABLE "new_NotificationPreferences" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "emailEnabled" BOOLEAN NOT NULL DEFAULT false,
    "pushEnabled" BOOLEAN NOT NULL DEFAULT true,
    "gameInviteEmail" BOOLEAN NOT NULL DEFAULT false,
    "gameInvitePush" BOOLEAN NOT NULL DEFAULT true,
    "gameReminderEmail" BOOLEAN NOT NULL DEFAULT false,
    "gameReminderPush" BOOLEAN NOT NULL DEFAULT true,
    "playerActivityPush" BOOLEAN NOT NULL DEFAULT true,
    "eventDetailsPush" BOOLEAN NOT NULL DEFAULT true,
    "weeklySummaryEmail" BOOLEAN NOT NULL DEFAULT false,
    "paymentReminderEmail" BOOLEAN NOT NULL DEFAULT false,
    "paymentReminderPush" BOOLEAN NOT NULL DEFAULT true,
    "reminder24h" BOOLEAN NOT NULL DEFAULT true,
    "reminder2h" BOOLEAN NOT NULL DEFAULT true,
    "reminder1h" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NotificationPreferences" ("createdAt", "emailEnabled", "eventDetailsPush", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "playerActivityPush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail") SELECT "createdAt", "emailEnabled", "eventDetailsPush", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "playerActivityPush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail" FROM "NotificationPreferences";
DROP TABLE "NotificationPreferences";
ALTER TABLE "new_NotificationPreferences" RENAME TO "NotificationPreferences";
CREATE UNIQUE INDEX "NotificationPreferences_userId_key" ON "NotificationPreferences"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "AppPushToken_token_key" ON "AppPushToken"("token");

-- CreateIndex
CREATE INDEX "AppPushToken_userId_idx" ON "AppPushToken"("userId");
