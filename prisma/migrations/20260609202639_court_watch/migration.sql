-- AlterTable
ALTER TABLE "Event" ADD COLUMN "courtWatchConfig" TEXT;

-- CreateTable
CREATE TABLE "CourtWatchAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "slotTime" TEXT NOT NULL,
    "slotDate" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "price" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "coordinate" TEXT,
    "address" TEXT,
    "notifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourtWatchAlert_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "CourtWatchAlert_eventId_idx" ON "CourtWatchAlert"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "CourtWatchAlert_eventId_tenantId_resourceId_slotDate_slotTime_key" ON "CourtWatchAlert"("eventId", "tenantId", "resourceId", "slotDate", "slotTime");
