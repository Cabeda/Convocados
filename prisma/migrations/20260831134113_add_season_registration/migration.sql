-- CreateTable
CREATE TABLE "Season" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'registration',
    "registrationOpensAt" DATETIME NOT NULL,
    "registrationClosesAt" DATETIME NOT NULL,
    "activatedAt" DATETIME,
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

-- CreateTable
CREATE TABLE "SeasonMembership" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "seasonId" TEXT NOT NULL,
    "eventPlayerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "SeasonMembership_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonMembership_eventPlayerId_fkey" FOREIGN KEY ("eventPlayerId") REFERENCES "EventPlayer" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SeasonMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Season_eventId_status_idx" ON "Season"("eventId", "status");

-- CreateIndex
CREATE INDEX "Season_createdByUserId_idx" ON "Season"("createdByUserId");

-- CreateIndex
CREATE INDEX "SeasonMembership_eventPlayerId_idx" ON "SeasonMembership"("eventPlayerId");

-- CreateIndex
CREATE INDEX "SeasonMembership_userId_idx" ON "SeasonMembership"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonMembership_seasonId_eventPlayerId_key" ON "SeasonMembership"("seasonId", "eventPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "SeasonMembership_seasonId_userId_key" ON "SeasonMembership"("seasonId", "userId");
