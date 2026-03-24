/*
  Warnings:

  - You are about to drop the `RateLimit` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropIndex
DROP INDEX "RateLimit_expiresAt_idx";

-- DropIndex
DROP INDEX "RateLimit_key_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "RateLimit";
PRAGMA foreign_keys=on;

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
    "accessPassword" TEXT,
    "eloEnabled" BOOLEAN NOT NULL DEFAULT true,
    "allowManualRating" BOOLEAN NOT NULL DEFAULT false,
    "splitCostsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Event_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Event" ("accessPassword", "allowManualRating", "archivedAt", "balanced", "createdAt", "dateTime", "eloEnabled", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "nextResetAt", "ownerId", "priorityDeadlineHours", "priorityEnabled", "priorityMaxPercent", "priorityMinGames", "priorityThreshold", "priorityWindow", "recurrenceRule", "sport", "teamOneName", "teamTwoName", "title", "updatedAt") SELECT "accessPassword", "allowManualRating", "archivedAt", "balanced", "createdAt", "dateTime", "eloEnabled", "id", "isPublic", "isRecurring", "latitude", "location", "longitude", "maxPlayers", "nextResetAt", "ownerId", "priorityDeadlineHours", "priorityEnabled", "priorityMaxPercent", "priorityMinGames", "priorityThreshold", "priorityWindow", "recurrenceRule", "sport", "teamOneName", "teamTwoName", "title", "updatedAt" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
CREATE INDEX "Event_ownerId_idx" ON "Event"("ownerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
