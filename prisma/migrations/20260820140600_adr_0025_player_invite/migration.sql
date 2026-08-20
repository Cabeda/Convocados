-- AlterTable
ALTER TABLE "EventPlayer" ADD COLUMN "invitationOptOutAt" DATETIME;

-- CreateTable
CREATE TABLE "PlayerInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "eventPlayerId" TEXT NOT NULL,
    "invitedByUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "token" TEXT NOT NULL,
    "notifiedAt" DATETIME,
    "respondedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerInvite_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayerInvite_eventPlayerId_fkey" FOREIGN KEY ("eventPlayerId") REFERENCES "EventPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PlayerInvite_invitedByUserId_fkey" FOREIGN KEY ("invitedByUserId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
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
    "postGamePush" BOOLEAN NOT NULL DEFAULT true,
    "weeklySummaryEmail" BOOLEAN NOT NULL DEFAULT false,
    "paymentReminderEmail" BOOLEAN NOT NULL DEFAULT false,
    "paymentReminderPush" BOOLEAN NOT NULL DEFAULT true,
    "invitesEnabled" BOOLEAN NOT NULL DEFAULT true,
    "reminder24h" BOOLEAN NOT NULL DEFAULT true,
    "reminder2h" BOOLEAN NOT NULL DEFAULT true,
    "reminder1h" BOOLEAN NOT NULL DEFAULT false,
    "digestMode" BOOLEAN NOT NULL DEFAULT false,
    "digestTime" TEXT NOT NULL DEFAULT '09:00',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NotificationPreferences" ("createdAt", "digestMode", "digestTime", "emailEnabled", "eventDetailsPush", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "playerActivityPush", "postGamePush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail") SELECT "createdAt", "digestMode", "digestTime", "emailEnabled", "eventDetailsPush", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "playerActivityPush", "postGamePush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail" FROM "NotificationPreferences";
DROP TABLE "NotificationPreferences";
ALTER TABLE "new_NotificationPreferences" RENAME TO "NotificationPreferences";
CREATE UNIQUE INDEX "NotificationPreferences_userId_key" ON "NotificationPreferences"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "PlayerInvite_token_key" ON "PlayerInvite"("token");

-- CreateIndex
CREATE INDEX "PlayerInvite_eventPlayerId_idx" ON "PlayerInvite"("eventPlayerId");

-- CreateIndex
CREATE INDEX "PlayerInvite_gameId_status_idx" ON "PlayerInvite"("gameId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerInvite_gameId_eventPlayerId_key" ON "PlayerInvite"("gameId", "eventPlayerId");
