-- Step 1: Backfill EventFollow from existing PushSubscription rows with userId
-- (ensures existing web-push subscribers become followers)
INSERT INTO "EventFollow" ("id", "eventId", "userId", "createdAt")
SELECT
  "PushSubscription"."id" || '_follow',
  "PushSubscription"."eventId",
  "PushSubscription"."userId",
  CURRENT_TIMESTAMP
FROM "PushSubscription"
WHERE "PushSubscription"."userId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "EventFollow" ef
    WHERE ef."eventId" = "PushSubscription"."eventId"
      AND ef."userId" = "PushSubscription"."userId"
  );

-- Step 2: Recreate PushSubscription as per-user (SQLite doesn't support DROP COLUMN)
CREATE TABLE "PushSubscription_new" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Step 3: Migrate data — deduplicate by taking the most recent row per (userId, endpoint)
INSERT INTO "PushSubscription_new" ("id", "userId", "endpoint", "p256dh", "auth", "locale", "createdAt")
SELECT "id", "userId", "endpoint", "p256dh", "auth", "locale", "createdAt"
FROM (
  SELECT *, ROW_NUMBER() OVER (PARTITION BY "userId", "endpoint" ORDER BY "createdAt" DESC) AS rn
  FROM "PushSubscription"
  WHERE "userId" IS NOT NULL
)
WHERE rn = 1;

-- Step 4: Drop old table and rename
DROP TABLE "PushSubscription";
ALTER TABLE "PushSubscription_new" RENAME TO "PushSubscription";

-- Step 5: Create indexes
CREATE UNIQUE INDEX "PushSubscription_userId_endpoint_key" ON "PushSubscription"("userId", "endpoint");
