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
    "priorityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "priorityThreshold" INTEGER NOT NULL DEFAULT 3,
    "priorityWindow" INTEGER NOT NULL DEFAULT 4,
    "priorityMaxPercent" INTEGER NOT NULL DEFAULT 70,
    "priorityDeadlineHours" INTEGER NOT NULL DEFAULT 48,
    "priorityMinGames" INTEGER NOT NULL DEFAULT 3,
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
    "courtWatchConfig" TEXT,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("accessPassword", "allowManualRating", "archivedAt", "balanced", "courtWatchConfig", "createdAt", "dateTime", "durationMinutes", "eloEnabled", "hideEloInTeams", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "mvpEloEnabled", "mvpEnabled", "nextResetAt", "notificationDefaults", "ownerId", "priorityDeadlineHours", "priorityEnabled", "priorityMaxPercent", "priorityMinGames", "priorityThreshold", "priorityWindow", "recurrenceRule", "showCompetitiveData", "splitCostsEnabled", "sport", "teamOneName", "teamTwoName", "timezone", "title", "updatedAt") SELECT "accessPassword", "allowManualRating", "archivedAt", "balanced", "courtWatchConfig", "createdAt", "dateTime", "durationMinutes", "eloEnabled", "hideEloInTeams", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "mvpEloEnabled", "mvpEnabled", "nextResetAt", "notificationDefaults", "ownerId", "priorityDeadlineHours", "priorityEnabled", "priorityMaxPercent", "priorityMinGames", "priorityThreshold", "priorityWindow", "recurrenceRule", "showCompetitiveData", "splitCostsEnabled", "sport", "teamOneName", "teamTwoName", "timezone", "title", "updatedAt" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_ownerId_idx" ON "Event"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
