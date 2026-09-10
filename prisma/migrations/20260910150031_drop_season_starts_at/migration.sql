/*
  Warnings:

  - You are about to drop the column `startsAt` on the `Season` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Season" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'registration',
    "registrationOpensAt" DATETIME NOT NULL,
    "registrationClosesAt" DATETIME NOT NULL,
    "activatedAt" DATETIME,
    "reviewStartedAt" DATETIME,
    "completedAt" DATETIME,
    "cancelledAt" DATETIME,
    "cancellationReason" TEXT,
    "ruleVersion" TEXT NOT NULL DEFAULT 'season-v1',
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Season_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Season_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Season" ("activatedAt", "cancellationReason", "cancelledAt", "completedAt", "createdAt", "createdByUserId", "eventId", "id", "name", "registrationClosesAt", "registrationOpensAt", "reviewStartedAt", "ruleVersion", "status", "updatedAt") SELECT "activatedAt", "cancellationReason", "cancelledAt", "completedAt", "createdAt", "createdByUserId", "eventId", "id", "name", "registrationClosesAt", "registrationOpensAt", "reviewStartedAt", "ruleVersion", "status", "updatedAt" FROM "Season";
DROP TABLE "Season";
ALTER TABLE "new_Season" RENAME TO "Season";
CREATE INDEX "Season_eventId_status_idx" ON "Season"("eventId", "status");
CREATE INDEX "Season_createdByUserId_idx" ON "Season"("createdByUserId");
-- Preserve the one-non-terminal-Season-per-Event invariant. This is a raw
-- partial index (not expressible in the Prisma schema); the table rebuild
-- above drops it, so recreate it here.
CREATE UNIQUE INDEX "Season_one_open_per_event_key"
  ON "Season"("eventId")
  WHERE "status" NOT IN ('completed', 'cancelled');
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
