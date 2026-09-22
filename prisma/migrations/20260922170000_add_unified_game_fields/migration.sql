-- AlterTable
ALTER TABLE "GameParticipant" ADD COLUMN "slot" INTEGER;
ALTER TABLE "GameParticipant" ADD COLUMN "team" TEXT;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MvpVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameHistoryId" TEXT NOT NULL,
    "gameId" TEXT,
    "voterPlayerId" TEXT NOT NULL,
    "voterName" TEXT NOT NULL,
    "votedForPlayerId" TEXT NOT NULL,
    "votedForName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MvpVote_gameHistoryId_fkey" FOREIGN KEY ("gameHistoryId") REFERENCES "GameHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MvpVote_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MvpVote" ("createdAt", "gameHistoryId", "id", "votedForName", "votedForPlayerId", "voterName", "voterPlayerId") SELECT "createdAt", "gameHistoryId", "id", "votedForName", "votedForPlayerId", "voterName", "voterPlayerId" FROM "MvpVote";
DROP TABLE "MvpVote";
ALTER TABLE "new_MvpVote" RENAME TO "MvpVote";
CREATE INDEX "MvpVote_gameHistoryId_idx" ON "MvpVote"("gameHistoryId");
CREATE INDEX "MvpVote_votedForPlayerId_idx" ON "MvpVote"("votedForPlayerId");
CREATE INDEX "MvpVote_gameId_idx" ON "MvpVote"("gameId");
CREATE UNIQUE INDEX "MvpVote_gameHistoryId_voterPlayerId_key" ON "MvpVote"("gameHistoryId", "voterPlayerId");
CREATE TABLE "new_Game" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "dateTime" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "isFriendly" BOOLEAN NOT NULL DEFAULT false,
    "scoreOne" INTEGER,
    "scoreTwo" INTEGER,
    "scoreSets" TEXT,
    "teamOneName" TEXT,
    "teamTwoName" TEXT,
    "teamOneFormation" TEXT,
    "teamTwoFormation" TEXT,
    "source" TEXT NOT NULL DEFAULT 'live',
    "eloProcessed" BOOLEAN NOT NULL DEFAULT false,
    "rsvpCutoffSent" BOOLEAN NOT NULL DEFAULT false,
    "costTotalAmount" REAL,
    "costCurrency" TEXT,
    "paymentMode" TEXT DEFAULT 'tracked',
    "payerEventPlayerId" TEXT,
    "payerExternalName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Game_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Game_payerEventPlayerId_fkey" FOREIGN KEY ("payerEventPlayerId") REFERENCES "EventPlayer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Game" ("costCurrency", "costTotalAmount", "createdAt", "dateTime", "eloProcessed", "eventId", "id", "isFriendly", "payerEventPlayerId", "payerExternalName", "paymentMode", "rsvpCutoffSent", "scoreOne", "scoreSets", "scoreTwo", "status", "teamOneName", "teamTwoName", "updatedAt") SELECT "costCurrency", "costTotalAmount", "createdAt", "dateTime", "eloProcessed", "eventId", "id", "isFriendly", "payerEventPlayerId", "payerExternalName", "paymentMode", "rsvpCutoffSent", "scoreOne", "scoreSets", "scoreTwo", "status", "teamOneName", "teamTwoName", "updatedAt" FROM "Game";
DROP TABLE "Game";
ALTER TABLE "new_Game" RENAME TO "Game";
CREATE INDEX "Game_eventId_dateTime_idx" ON "Game"("eventId", "dateTime");
CREATE INDEX "Game_eventId_status_idx" ON "Game"("eventId", "status");
CREATE INDEX "Game_payerEventPlayerId_idx" ON "Game"("payerEventPlayerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
