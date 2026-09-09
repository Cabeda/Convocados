-- AlterTable
ALTER TABLE "Season" ADD COLUMN "startsAt" DATETIME;

-- CreateTable
CREATE TABLE "Crew" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Crew_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_SeasonMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "eventPlayerId" TEXT NOT NULL,
    "crewId" TEXT,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeasonMembership_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonMembership_eventPlayerId_fkey" FOREIGN KEY ("eventPlayerId") REFERENCES "EventPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonMembership_crewId_fkey" FOREIGN KEY ("crewId") REFERENCES "Crew" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "SeasonMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_SeasonMembership" ("createdAt", "eventPlayerId", "id", "joinedAt", "seasonId", "status", "updatedAt", "userId", "withdrawnAt") SELECT "createdAt", "eventPlayerId", "id", "joinedAt", "seasonId", "status", "updatedAt", "userId", "withdrawnAt" FROM "SeasonMembership";
DROP TABLE "SeasonMembership";
ALTER TABLE "new_SeasonMembership" RENAME TO "SeasonMembership";
CREATE INDEX "SeasonMembership_eventPlayerId_idx" ON "SeasonMembership"("eventPlayerId");
CREATE INDEX "SeasonMembership_userId_idx" ON "SeasonMembership"("userId");
CREATE UNIQUE INDEX "SeasonMembership_seasonId_eventPlayerId_key" ON "SeasonMembership"("seasonId", "eventPlayerId");
CREATE UNIQUE INDEX "SeasonMembership_seasonId_userId_key" ON "SeasonMembership"("seasonId", "userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "Crew_seasonId_idx" ON "Crew"("seasonId");

-- CreateIndex
CREATE UNIQUE INDEX "Crew_seasonId_name_key" ON "Crew"("seasonId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Crew_seasonId_sortOrder_key" ON "Crew"("seasonId", "sortOrder");
