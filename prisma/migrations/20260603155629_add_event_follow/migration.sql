-- CreateTable
CREATE TABLE "EventFollow" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventFollow_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EventFollow_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EventFollow_userId_idx" ON "EventFollow"("userId");

-- CreateIndex
CREATE INDEX "EventFollow_eventId_idx" ON "EventFollow"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "EventFollow_eventId_userId_key" ON "EventFollow"("eventId", "userId");

-- Backfill EventFollow for existing linked Player records
INSERT INTO "EventFollow" ("id", "eventId", "userId", "createdAt")
SELECT printf('%s_%s', "eventId", "userId"), "eventId", "userId", CURRENT_TIMESTAMP
FROM "Player"
WHERE "userId" IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM "EventFollow" ef
  WHERE ef."eventId" = "Player"."eventId" AND ef."userId" = "Player"."userId"
);
