-- AlterTable
ALTER TABLE "CourtWatch" ADD COLUMN "lastCheckedAt" DATETIME;

-- CreateTable
CREATE TABLE "PlaytomicAvailabilityCache" (
    "cacheKey" TEXT NOT NULL PRIMARY KEY,
    "courtsJson" TEXT NOT NULL,
    "fetchedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "PlaytomicAvailabilityCache_fetchedAt_idx" ON "PlaytomicAvailabilityCache"("fetchedAt");
