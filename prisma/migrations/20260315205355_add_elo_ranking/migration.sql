-- CreateTable
CREATE TABLE "PlayerRating" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "userId" TEXT,
    "rating" REAL NOT NULL DEFAULT 1000,
    "gamesPlayed" INTEGER NOT NULL DEFAULT 0,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "draws" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerRating_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GameHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "dateTime" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'played',
    "scoreOne" INTEGER,
    "scoreTwo" INTEGER,
    "teamOneName" TEXT NOT NULL,
    "teamTwoName" TEXT NOT NULL,
    "teamsSnapshot" TEXT,
    "editableUntil" DATETIME NOT NULL,
    "eloProcessed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameHistory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GameHistory" ("createdAt", "dateTime", "editableUntil", "eventId", "id", "scoreOne", "scoreTwo", "status", "teamOneName", "teamTwoName", "teamsSnapshot") SELECT "createdAt", "dateTime", "editableUntil", "eventId", "id", "scoreOne", "scoreTwo", "status", "teamOneName", "teamTwoName", "teamsSnapshot" FROM "GameHistory";
DROP TABLE "GameHistory";
ALTER TABLE "new_GameHistory" RENAME TO "GameHistory";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "PlayerRating_userId_idx" ON "PlayerRating"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerRating_eventId_name_key" ON "PlayerRating"("eventId", "name");
