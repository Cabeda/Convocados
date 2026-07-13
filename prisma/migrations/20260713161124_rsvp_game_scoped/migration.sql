-- ADR 0016: Migrate Rsvp from event-scoped (userId/playerId + eventId) to
-- game-scoped (eventPlayerId + gameId). Single key on EventPlayer identity.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Rsvp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventPlayerId" TEXT NOT NULL,
    "gameId" TEXT NOT NULL,
    "status" TEXT,
    "respondedAt" DATETIME,
    "respondedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Rsvp_eventPlayerId_fkey" FOREIGN KEY ("eventPlayerId") REFERENCES "EventPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rsvp_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rsvp_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- Backfill: resolve eventPlayerId and gameId from existing RSVPs.
-- Case 1: userId-keyed RSVPs → join through Player.userId to find the EventPlayer
INSERT INTO "new_Rsvp" ("id", "eventPlayerId", "gameId", "status", "respondedAt", "respondedByUserId", "createdAt", "updatedAt")
SELECT
    r."id",
    ep."id" AS "eventPlayerId",
    e."currentGameId" AS "gameId",
    r."status",
    r."respondedAt",
    r."respondedByUserId",
    r."createdAt",
    r."updatedAt"
FROM "Rsvp" r
JOIN "Event" e ON e."id" = r."eventId"
JOIN "Player" p ON p."userId" = r."userId" AND p."eventId" = r."eventId"
JOIN "EventPlayer" ep ON ep."eventId" = r."eventId" AND ep."name" = p."name"
WHERE r."userId" IS NOT NULL
  AND e."currentGameId" IS NOT NULL;

-- Case 2: playerId-keyed RSVPs (guest players) → join through Player.name to EventPlayer
INSERT OR IGNORE INTO "new_Rsvp" ("id", "eventPlayerId", "gameId", "status", "respondedAt", "respondedByUserId", "createdAt", "updatedAt")
SELECT
    r."id",
    ep."id" AS "eventPlayerId",
    e."currentGameId" AS "gameId",
    r."status",
    r."respondedAt",
    r."respondedByUserId",
    r."createdAt",
    r."updatedAt"
FROM "Rsvp" r
JOIN "Player" p ON p."id" = r."playerId"
JOIN "Event" e ON e."id" = r."eventId"
JOIN "EventPlayer" ep ON ep."eventId" = r."eventId" AND ep."name" = p."name"
WHERE r."playerId" IS NOT NULL
  AND e."currentGameId" IS NOT NULL;

DROP TABLE "Rsvp";
ALTER TABLE "new_Rsvp" RENAME TO "Rsvp";
CREATE INDEX "Rsvp_gameId_status_idx" ON "Rsvp"("gameId", "status");
CREATE UNIQUE INDEX "Rsvp_eventPlayerId_gameId_key" ON "Rsvp"("eventPlayerId", "gameId");

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
