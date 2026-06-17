-- CreateTable
CREATE TABLE "Rsvp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "status" TEXT,
    "respondedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Rsvp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "UserAppOpen" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "day" DATETIME NOT NULL,
    CONSTRAINT "UserAppOpen_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "priorityEnabled" BOOLEAN NOT NULL DEFAULT false,
    "priorityThreshold" INTEGER NOT NULL DEFAULT 3,
    "priorityWindow" INTEGER NOT NULL DEFAULT 4,
    "priorityMaxPercent" INTEGER NOT NULL DEFAULT 70,
    "priorityDeadlineHours" INTEGER NOT NULL DEFAULT 48,
    "priorityMinGames" INTEGER NOT NULL DEFAULT 3,
    "rsvpCutoffSent" BOOLEAN NOT NULL DEFAULT false,
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
INSERT INTO "new_Event" ("accessPassword", "allowManualRating", "archivedAt", "balanced", "courtWatchConfig", "createdAt", "dateTime", "durationMinutes", "eloEnabled", "hideEloInTeams", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "mvpEloEnabled", "mvpEnabled", "nextResetAt", "notificationDefaults", "ownerId", "paymentEnforcementLevel", "paymentGateThreshold", "priorityDeadlineHours", "priorityEnabled", "priorityMaxPercent", "priorityMinGames", "priorityThreshold", "priorityWindow", "recurrenceRule", "showCompetitiveData", "showDebtorNames", "splitCostsEnabled", "sport", "teamOneName", "teamTwoName", "timezone", "title", "updatedAt") SELECT "accessPassword", "allowManualRating", "archivedAt", "balanced", "courtWatchConfig", "createdAt", "dateTime", "durationMinutes", "eloEnabled", "hideEloInTeams", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "mvpEloEnabled", "mvpEnabled", "nextResetAt", "notificationDefaults", "ownerId", "paymentEnforcementLevel", "paymentGateThreshold", "priorityDeadlineHours", "priorityEnabled", "priorityMaxPercent", "priorityMinGames", "priorityThreshold", "priorityWindow", "recurrenceRule", "showCompetitiveData", "showDebtorNames", "splitCostsEnabled", "sport", "teamOneName", "teamTwoName", "timezone", "title", "updatedAt" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_ownerId_idx" ON "Event"("ownerId");
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "role" TEXT NOT NULL DEFAULT 'user',
    "publicStats" BOOLEAN NOT NULL DEFAULT true,
    "profileVisibility" TEXT NOT NULL DEFAULT 'public',
    "pushPromptState" TEXT NOT NULL DEFAULT 'default',
    "pushPromptLastDismissedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_User" ("createdAt", "email", "emailVerified", "id", "image", "name", "profileVisibility", "publicStats", "role", "updatedAt") SELECT "createdAt", "email", "emailVerified", "id", "image", "name", "profileVisibility", "publicStats", "role", "updatedAt" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Rsvp_eventId_status_idx" ON "Rsvp"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Rsvp_userId_eventId_key" ON "Rsvp"("userId", "eventId");

-- CreateIndex
CREATE INDEX "UserAppOpen_userId_day_idx" ON "UserAppOpen"("userId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "UserAppOpen_userId_day_key" ON "UserAppOpen"("userId", "day");
