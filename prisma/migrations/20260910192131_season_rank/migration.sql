-- CreateTable
CREATE TABLE "SeasonRankSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SeasonRankSnapshot_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonRankSnapshot_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "recruitment48hSent" BOOLEAN NOT NULL DEFAULT false,
    "recruitment24hSent" BOOLEAN NOT NULL DEFAULT false,
    "accessPassword" TEXT,
    "showCompetitiveData" BOOLEAN NOT NULL DEFAULT true,
    "eloEnabled" BOOLEAN NOT NULL DEFAULT true,
    "hideEloInTeams" BOOLEAN NOT NULL DEFAULT false,
    "allowManualRating" BOOLEAN NOT NULL DEFAULT false,
    "rankEnabled" BOOLEAN NOT NULL DEFAULT true,
    "rankDecayEnabled" BOOLEAN NOT NULL DEFAULT false,
    "inactiveRankBehavior" TEXT NOT NULL DEFAULT 'freeze',
    "rankAnchor" REAL,
    "rankTierEdges" TEXT,
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
    "source" TEXT NOT NULL DEFAULT 'manual',
    "sourceKey" TEXT,
    "playtomicTenantId" TEXT,
    "playtomicTenantName" TEXT,
    "adoptedAt" DATETIME,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("accessPassword", "adoptedAt", "allowManualRating", "archivedAt", "autoConfirmEnabled", "autoConfirmThreshold", "balanced", "courtWatchConfig", "createdAt", "currentGameId", "dateTime", "durationMinutes", "eloEnabled", "fewSpotsLeftNotified", "hideEloInTeams", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "mvpEloEnabled", "mvpEnabled", "nextResetAt", "notificationDefaults", "ownerId", "paymentEnforcementLevel", "paymentGateThreshold", "playtomicTenantId", "playtomicTenantName", "priorityDeadlineHours", "priorityEnabled", "priorityMaxPercent", "priorityMinGames", "priorityThreshold", "priorityWindow", "recruitment24hSent", "recruitment48hSent", "recruitmentThreshold", "recurrenceRule", "rsvpCutoffSent", "showCompetitiveData", "showDebtorNames", "source", "sourceKey", "splitCostsEnabled", "sport", "teamOneName", "teamTwoName", "timezone", "title", "updatedAt") SELECT "accessPassword", "adoptedAt", "allowManualRating", "archivedAt", "autoConfirmEnabled", "autoConfirmThreshold", "balanced", "courtWatchConfig", "createdAt", "currentGameId", "dateTime", "durationMinutes", "eloEnabled", "fewSpotsLeftNotified", "hideEloInTeams", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "mvpEloEnabled", "mvpEnabled", "nextResetAt", "notificationDefaults", "ownerId", "paymentEnforcementLevel", "paymentGateThreshold", "playtomicTenantId", "playtomicTenantName", "priorityDeadlineHours", "priorityEnabled", "priorityMaxPercent", "priorityMinGames", "priorityThreshold", "priorityWindow", "recruitment24hSent", "recruitment48hSent", "recruitmentThreshold", "recurrenceRule", "rsvpCutoffSent", "showCompetitiveData", "showDebtorNames", "source", "sourceKey", "splitCostsEnabled", "sport", "teamOneName", "teamTwoName", "timezone", "title", "updatedAt" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_ownerId_idx" ON "Event"("ownerId");
CREATE INDEX "Event_source_archivedAt_idx" ON "Event"("source", "archivedAt");
CREATE UNIQUE INDEX "Event_sourceKey_key" ON "Event"("sourceKey");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "SeasonRankSnapshot_seasonId_key" ON "SeasonRankSnapshot"("seasonId");

-- CreateIndex
CREATE INDEX "SeasonRankSnapshot_eventId_idx" ON "SeasonRankSnapshot"("eventId");
