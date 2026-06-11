-- RedefineTable: make CourtWatchAlert.price and .currency nullable
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_CourtWatchAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tenantName" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "resourceName" TEXT NOT NULL,
    "slotTime" TEXT NOT NULL,
    "slotDate" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "price" REAL,
    "currency" TEXT DEFAULT 'EUR',
    "coordinate" TEXT,
    "address" TEXT,
    "notifiedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CourtWatchAlert_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_CourtWatchAlert" ("address", "coordinate", "currency", "duration", "eventId", "id", "notifiedAt", "price", "resourceId", "resourceName", "slotDate", "slotTime", "tenantId", "tenantName") SELECT "address", "coordinate", "currency", "duration", "eventId", "id", "notifiedAt", "price", "resourceId", "resourceName", "slotDate", "slotTime", "tenantId", "tenantName" FROM "CourtWatchAlert";
DROP TABLE "CourtWatchAlert";
ALTER TABLE "new_CourtWatchAlert" RENAME TO "CourtWatchAlert";
CREATE INDEX "CourtWatchAlert_eventId_idx" ON "CourtWatchAlert"("eventId");
CREATE UNIQUE INDEX "CourtWatchAlert_eventId_tenantId_resourceId_slotDate_slotTime_key" ON "CourtWatchAlert"("eventId", "tenantId", "resourceId", "slotDate", "slotTime");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
