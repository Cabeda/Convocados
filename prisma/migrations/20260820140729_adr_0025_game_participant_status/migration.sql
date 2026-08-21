-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GameParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "gameId" TEXT NOT NULL,
    "eventPlayerId" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" DATETIME,
    "noShow" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameParticipant_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GameParticipant_eventPlayerId_fkey" FOREIGN KEY ("eventPlayerId") REFERENCES "EventPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GameParticipant" ("archivedAt", "createdAt", "eventPlayerId", "gameId", "id", "noShow", "order") SELECT "archivedAt", "createdAt", "eventPlayerId", "gameId", "id", "noShow", "order" FROM "GameParticipant";
DROP TABLE "GameParticipant";
ALTER TABLE "new_GameParticipant" RENAME TO "GameParticipant";
CREATE INDEX "GameParticipant_eventPlayerId_idx" ON "GameParticipant"("eventPlayerId");
CREATE UNIQUE INDEX "GameParticipant_gameId_eventPlayerId_key" ON "GameParticipant"("gameId", "eventPlayerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
