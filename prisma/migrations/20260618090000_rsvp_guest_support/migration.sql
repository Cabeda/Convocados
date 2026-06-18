-- RedefineTables
-- Rsvp: userId becomes nullable; add playerId (guests), respondedByUserId (audit),
-- and updatedAt. Existing rows keep userId; playerId/respondedByUserId default null.
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Rsvp" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "playerId" TEXT,
    "eventId" TEXT NOT NULL,
    "status" TEXT,
    "respondedAt" DATETIME,
    "respondedByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Rsvp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rsvp_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Rsvp_respondedByUserId_fkey" FOREIGN KEY ("respondedByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Rsvp_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Rsvp" ("id", "userId", "eventId", "status", "respondedAt", "createdAt", "updatedAt")
SELECT "id", "userId", "eventId", "status", "respondedAt", "createdAt", "createdAt" FROM "Rsvp";
DROP TABLE "Rsvp";
ALTER TABLE "new_Rsvp" RENAME TO "Rsvp";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Rsvp_eventId_status_idx" ON "Rsvp"("eventId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Rsvp_userId_eventId_key" ON "Rsvp"("userId", "eventId");

-- CreateIndex
CREATE UNIQUE INDEX "Rsvp_playerId_eventId_key" ON "Rsvp"("playerId", "eventId");
