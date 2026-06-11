-- CreateTable
CREATE TABLE "CourtWatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "sport" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "resourceId" TEXT,
    "resourceName" TEXT,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL DEFAULT 90,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "maxPrice" REAL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "CourtWatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "CourtWatchHit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "watchId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "slotDate" TEXT NOT NULL,
    "slotTime" TEXT NOT NULL,
    "notifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourtWatchHit_watchId_fkey" FOREIGN KEY ("watchId") REFERENCES "CourtWatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CourtWatch_userId_idx" ON "CourtWatch"("userId");

-- CreateIndex
CREATE INDEX "CourtWatch_active_idx" ON "CourtWatch"("active");

-- CreateIndex
CREATE INDEX "CourtWatchHit_watchId_idx" ON "CourtWatchHit"("watchId");

-- CreateIndex
CREATE UNIQUE INDEX "CourtWatchHit_watchId_resourceId_slotDate_slotTime_key" ON "CourtWatchHit"("watchId", "resourceId", "slotDate", "slotTime");
