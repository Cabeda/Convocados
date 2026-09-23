-- Match Events: the post-game timeline of a settled Game (ADR 0039).
-- Goals recorded here become the derived team score for goal-scoring sports.
CREATE TABLE "MatchEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameHistoryId" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'goal',
    "team" TEXT NOT NULL DEFAULT 'unknown',
    "minute" INTEGER,
    "ownGoal" BOOLEAN NOT NULL DEFAULT false,
    "penalty" BOOLEAN NOT NULL DEFAULT false,
    "scorerEventPlayerId" TEXT,
    "scorerName" TEXT NOT NULL,
    "assistEventPlayerId" TEXT,
    "assistName" TEXT,
    "createdById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchEvent_gameHistoryId_fkey" FOREIGN KEY ("gameHistoryId") REFERENCES "GameHistory" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Per-event role: "admin" (full management) or "statistician" (may log Match Events only).
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EventAdmin" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'admin',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventAdmin_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventAdmin_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EventAdmin" ("createdAt", "eventId", "id", "userId") SELECT "createdAt", "eventId", "id", "userId" FROM "EventAdmin";
DROP TABLE "EventAdmin";
ALTER TABLE "new_EventAdmin" RENAME TO "EventAdmin";
CREATE INDEX "EventAdmin_userId_idx" ON "EventAdmin"("userId");
CREATE UNIQUE INDEX "EventAdmin_eventId_userId_key" ON "EventAdmin"("eventId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "MatchEvent_gameHistoryId_idx" ON "MatchEvent"("gameHistoryId");

-- CreateIndex
CREATE INDEX "MatchEvent_scorerEventPlayerId_idx" ON "MatchEvent"("scorerEventPlayerId");
