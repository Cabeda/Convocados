-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Event" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "location" TEXT NOT NULL,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_Event" ("balanced", "createdAt", "dateTime", "id", "isPublic", "isRecurring", "location", "maxPlayers", "nextResetAt", "recurrenceRule", "teamOneName", "teamTwoName", "title", "updatedAt") SELECT "balanced", "createdAt", "dateTime", "id", "isPublic", "isRecurring", "location", "maxPlayers", "nextResetAt", "recurrenceRule", "teamOneName", "teamTwoName", "title", "updatedAt" FROM "Event";
DROP TABLE "Event";
ALTER TABLE "new_Event" RENAME TO "Event";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
