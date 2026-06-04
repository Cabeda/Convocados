-- Backfill EventFollow for linked Player records.
-- Safe to run multiple times: only inserts rows that don't already exist.
-- Uses Player.id (which is unique) as the EventFollow id to avoid PK conflicts
-- in case of duplicate (eventId, userId) pairs in Player.

INSERT INTO "EventFollow" ("id", "eventId", "userId", "createdAt")
SELECT
  "Player"."id",
  "Player"."eventId",
  "Player"."userId",
  CURRENT_TIMESTAMP
FROM "Player"
WHERE "Player"."userId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "EventFollow" ef
    WHERE ef."eventId" = "Player"."eventId" AND ef."userId" = "Player"."userId"
  );
