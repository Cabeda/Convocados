-- CreateTable
CREATE TABLE "PriorityEnrollment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'auto',
    "optedIn" BOOLEAN NOT NULL DEFAULT true,
    "declineStreak" INTEGER NOT NULL DEFAULT 0,
    "noShowStreak" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PriorityEnrollment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PriorityEnrollment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PriorityConfirmation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "gameDate" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "notifiedAt" DATETIME NOT NULL,
    "respondedAt" DATETIME,
    "deadline" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriorityConfirmation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PriorityConfirmation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
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
    "maxPlayers" INTEGER NOT NULL DEFAULT 10,
    "teamOneName" TEXT NOT NULL DEFAULT 'Ninjas',
    "teamTwoName" TEXT NOT NULL DEFAULT 'Gunas',
    "sport" TEXT NOT NULL DEFAULT 'football-5v5',
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("balanced", "createdAt", "dateTime", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "nextResetAt", "ownerId", "recurrenceRule", "sport", "teamOneName", "teamTwoName", "title", "updatedAt") SELECT "balanced", "createdAt", "dateTime", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "nextResetAt", "ownerId", "recurrenceRule", "sport", "teamOneName", "teamTwoName", "title", "updatedAt" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_ownerId_idx" ON "Event"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PriorityEnrollment_eventId_idx" ON "PriorityEnrollment"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PriorityEnrollment_eventId_userId_key" ON "PriorityEnrollment"("eventId", "userId");

-- CreateIndex
CREATE INDEX "PriorityConfirmation_eventId_gameDate_idx" ON "PriorityConfirmation"("eventId", "gameDate");

-- CreateIndex
CREATE INDEX "PriorityConfirmation_deadline_idx" ON "PriorityConfirmation"("deadline");

-- CreateIndex
CREATE UNIQUE INDEX "PriorityConfirmation_eventId_userId_gameDate_key" ON "PriorityConfirmation"("eventId", "userId", "gameDate");
