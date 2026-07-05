-- AlterTable
ALTER TABLE "Event" ADD COLUMN "currentGameId" TEXT;

-- CreateTable
CREATE TABLE "Game" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "dateTime" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "isFriendly" BOOLEAN NOT NULL DEFAULT false,
    "scoreOne" INTEGER,
    "scoreTwo" INTEGER,
    "teamOneName" TEXT,
    "teamTwoName" TEXT,
    "eloProcessed" BOOLEAN NOT NULL DEFAULT false,
    "rsvpCutoffSent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Game_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "EventPlayer" (
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
    CONSTRAINT "EventPlayer_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GameParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "eventPlayerId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GameParticipant_eventPlayerId_fkey" FOREIGN KEY ("eventPlayerId") REFERENCES "EventPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "GamePayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "eventPlayerId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "method" TEXT,
    "paidAt" DATETIME,
    "markedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "GamePayment_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GamePayment_eventPlayerId_fkey" FOREIGN KEY ("eventPlayerId") REFERENCES "EventPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Rsvp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "playerId" TEXT,
    "eventId" TEXT NOT NULL,
    "status" TEXT,
    "respondedAt" DATETIME,
    "respondedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Rsvp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rsvp_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rsvp_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Rsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Rsvp" ("createdAt", "eventId", "id", "playerId", "respondedAt", "respondedByUserId", "status", "updatedAt", "userId") SELECT "createdAt", "eventId", "id", "playerId", "respondedAt", "respondedByUserId", "status", "updatedAt", "userId" FROM "Rsvp";
DROP TABLE "Rsvp";
ALTER TABLE "new_Rsvp" RENAME TO "Rsvp";
CREATE INDEX "Rsvp_eventId_status_idx" ON "Rsvp"("eventId", "status");
CREATE UNIQUE INDEX "Rsvp_userId_eventId_key" ON "Rsvp"("userId", "eventId");
CREATE UNIQUE INDEX "Rsvp_playerId_eventId_key" ON "Rsvp"("playerId", "eventId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Game_eventId_dateTime_idx" ON "Game"("eventId", "dateTime");

-- CreateIndex
CREATE INDEX "Game_eventId_status_idx" ON "Game"("eventId", "status");

-- CreateIndex
CREATE INDEX "EventPlayer_userId_idx" ON "EventPlayer"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EventPlayer_eventId_name_key" ON "EventPlayer"("eventId", "name");

-- CreateIndex
CREATE INDEX "GameParticipant_eventPlayerId_idx" ON "GameParticipant"("eventPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "GameParticipant_gameId_eventPlayerId_key" ON "GameParticipant"("gameId", "eventPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "GamePayment_gameId_eventPlayerId_key" ON "GamePayment"("gameId", "eventPlayerId");
