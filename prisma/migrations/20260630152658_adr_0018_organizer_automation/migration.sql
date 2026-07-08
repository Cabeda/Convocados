-- CreateTable
CREATE TABLE "PaymentNudgeStage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stage" INTEGER NOT NULL DEFAULT 0,
    "lastSentAt" DATETIME,
    "organiserAlert" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "latitude" REAL,
    "longitude" REAL,
    "dateTime" DATETIME NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "maxPlayers" INTEGER NOT NULL DEFAULT 10,
    "teamOneName" TEXT NOT NULL DEFAULT 'Ninjas',
    "teamTwoName" TEXT NOT NULL DEFAULT 'Gunas',
    "sport" TEXT NOT NULL DEFAULT 'football-5v5',
    "durationMinutes" INTEGER NOT NULL DEFAULT 60,
    "isPublic" BOOLEAN NOT NULL DEFAULT false,
    "balanced" BOOLEAN NOT NULL DEFAULT false,
    "isRecurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceRule" TEXT,
    "nextResetAt" DATETIME,
    "ownerId" TEXT,
    "currentGameId" TEXT,
    "priorityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "priorityThreshold" INTEGER NOT NULL DEFAULT 3,
    "priorityWindow" INTEGER NOT NULL DEFAULT 4,
    "priorityMaxPercent" INTEGER NOT NULL DEFAULT 70,
    "priorityDeadlineHours" INTEGER NOT NULL DEFAULT 48,
    "priorityMinGames" INTEGER NOT NULL DEFAULT 3,
    "rsvpCutoffSent" BOOLEAN NOT NULL DEFAULT false,
    "fewSpotsLeftNotified" BOOLEAN NOT NULL DEFAULT false,
    "accessPassword" TEXT,
    "showCompetitiveData" BOOLEAN NOT NULL DEFAULT true,
    "eloEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hideEloInTeams" BOOLEAN NOT NULL DEFAULT false,
    "allowManualRating" BOOLEAN NOT NULL DEFAULT false,
    "splitCostsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "paymentEnforcementLevel" TEXT NOT NULL DEFAULT 'nudge',
    "paymentGateThreshold" REAL NOT NULL DEFAULT 0,
    "showDebtorNames" BOOLEAN NOT NULL DEFAULT false,
    "mvpEnabled" BOOLEAN NOT NULL DEFAULT true,
    "mvpEloEnabled" BOOLEAN NOT NULL DEFAULT false,
    "notificationDefaults" TEXT,
    "recruitmentThreshold" INTEGER NOT NULL DEFAULT 3,
    "autoConfirmEnabled" BOOLEAN NOT NULL DEFAULT false,
    "autoConfirmThreshold" INTEGER NOT NULL DEFAULT 3,
    "courtWatchConfig" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("accessPassword", "allowManualRating", "archivedAt", "balanced", "courtWatchConfig", "createdAt", "currentGameId", "dateTime", "durationMinutes", "eloEnabled", "fewSpotsLeftNotified", "hideEloInTeams", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "mvpEloEnabled", "mvpEnabled", "nextResetAt", "notificationDefaults", "ownerId", "paymentEnforcementLevel", "paymentGateThreshold", "priorityDeadlineHours", "priorityEnabled", "priorityMaxPercent", "priorityMinGames", "priorityThreshold", "priorityWindow", "recruitmentThreshold", "recurrenceRule", "rsvpCutoffSent", "showCompetitiveData", "showDebtorNames", "splitCostsEnabled", "sport", "teamOneName", "teamTwoName", "timezone", "title", "updatedAt") SELECT "accessPassword", "allowManualRating", "archivedAt", "balanced", "courtWatchConfig", "createdAt", "currentGameId", "dateTime", "durationMinutes", "eloEnabled", "fewSpotsLeftNotified", "hideEloInTeams", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "mvpEloEnabled", "mvpEnabled", "nextResetAt", "notificationDefaults", "ownerId", "paymentEnforcementLevel", "paymentGateThreshold", "priorityDeadlineHours", "priorityEnabled", "priorityMaxPercent", "priorityMinGames", "priorityThreshold", "priorityWindow", "recruitmentThreshold", "recurrenceRule", "rsvpCutoffSent", "showCompetitiveData", "showDebtorNames", "splitCostsEnabled", "sport", "teamOneName", "teamTwoName", "timezone", "title", "updatedAt" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_ownerId_idx" ON "Event"("ownerId");
CREATE TABLE "new_GameParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "eventPlayerId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "noShow" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GameParticipant_eventPlayerId_fkey" FOREIGN KEY ("eventPlayerId") REFERENCES "EventPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GameParticipant" ("archivedAt", "createdAt", "eventPlayerId", "gameId", "id", "order") SELECT "archivedAt", "createdAt", "eventPlayerId", "gameId", "id", "order" FROM "GameParticipant";
DROP TABLE "GameParticipant";
ALTER TABLE "new_GameParticipant" RENAME TO "GameParticipant";
CREATE INDEX "GameParticipant_eventPlayerId_idx" ON "GameParticipant"("eventPlayerId");
CREATE UNIQUE INDEX "GameParticipant_gameId_eventPlayerId_key" ON "GameParticipant"("gameId", "eventPlayerId");
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
    "reminder24h" BOOLEAN NOT NULL DEFAULT true,
    "reminder2h" BOOLEAN NOT NULL DEFAULT true,
    "reminder1h" BOOLEAN NOT NULL DEFAULT false,
    "digestMode" BOOLEAN NOT NULL DEFAULT false,
    "digestTime" TEXT NOT NULL DEFAULT '09:00',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "NotificationPreferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_NotificationPreferences" ("createdAt", "emailEnabled", "eventDetailsPush", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "playerActivityPush", "postGamePush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail") SELECT "createdAt", "emailEnabled", "eventDetailsPush", "gameInviteEmail", "gameInvitePush", "gameReminderEmail", "gameReminderPush", "id", "paymentReminderEmail", "paymentReminderPush", "playerActivityPush", "postGamePush", "pushEnabled", "reminder1h", "reminder24h", "reminder2h", "updatedAt", "userId", "weeklySummaryEmail" FROM "NotificationPreferences";
DROP TABLE "NotificationPreferences";
ALTER TABLE "new_NotificationPreferences" RENAME TO "NotificationPreferences";
CREATE UNIQUE INDEX "NotificationPreferences_userId_key" ON "NotificationPreferences"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PaymentNudgeStage_eventId_idx" ON "PaymentNudgeStage"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentNudgeStage_eventId_userId_key" ON "PaymentNudgeStage"("eventId", "userId");
