-- Backfill EventFollow for all players who have a linked user account.
-- This ensures every registered player sees the event in "My Games".
INSERT OR IGNORE INTO "EventFollow" ("id", "eventId", "userId", "createdAt")
SELECT
  "Player"."id" || '_autofollow',
  "Player"."eventId",
  "Player"."userId",
  COALESCE("Player"."createdAt", CURRENT_TIMESTAMP)
FROM "Player"
WHERE "Player"."userId" IS NOT NULL
  AND "Player"."archivedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "EventFollow" ef
    WHERE ef."eventId" = "Player"."eventId"
      AND ef."userId" = "Player"."userId"
  );
