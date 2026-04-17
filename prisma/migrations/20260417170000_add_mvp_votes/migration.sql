-- CreateTable
CREATE TABLE "MvpVote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameHistoryId" TEXT NOT NULL,
    "voterPlayerId" TEXT NOT NULL,
    "voterName" TEXT NOT NULL,
    "votedForPlayerId" TEXT NOT NULL,
    "votedForName" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MvpVote_gameHistoryId_fkey" FOREIGN KEY ("gameHistoryId") REFERENCES "GameHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MvpVote_gameHistoryId_idx" ON "MvpVote"("gameHistoryId");

-- CreateIndex
CREATE INDEX "MvpVote_votedForPlayerId_idx" ON "MvpVote"("votedForPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "MvpVote_gameHistoryId_voterPlayerId_key" ON "MvpVote"("gameHistoryId", "voterPlayerId");
