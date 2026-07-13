-- ADR 0016: Migrate Rsvp from event-scoped (userId/playerId + eventId) to
-- game-scoped (eventPlayerId + gameId). Single key on EventPlayer identity.

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

-- Drop new_Rsvp if it exists from a previous failed attempt
DROP TABLE IF EXISTS "new_Rsvp";

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
-- Uses INSERT OR IGNORE to skip duplicates (same eventPlayerId+gameId from multiple Player rows).
-- RSVPs that can't be resolved (no EventPlayer, no currentGameId) are silently dropped (stale data).

-- Case 1: userId-keyed RSVPs → join through Player.userId to find the EventPlayer
-- Use GROUP BY to deduplicate when multiple Player rows exist for same user+event
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
JOIN "Event" e ON e."id" = r."eventId"
JOIN "Player" p ON p."userId" = r."userId" AND p."eventId" = r."eventId" AND p."archivedAt" IS NULL
JOIN "EventPlayer" ep ON ep."eventId" = r."eventId" AND ep."name" = p."name"
WHERE r."userId" IS NOT NULL
  AND e."currentGameId" IS NOT NULL
GROUP BY ep."id", e."currentGameId";

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
