-- CreateTable
CREATE TABLE "ScheduledJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT,
    "type" TEXT NOT NULL,
    "payload" TEXT NOT NULL DEFAULT '{}',
    "runAt" DATETIME NOT NULL,
    "processedAt" DATETIME,
    "failedAt" DATETIME,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "ScheduledJob_runAt_processedAt_idx" ON "ScheduledJob"("runAt", "processedAt");

-- CreateIndex
CREATE INDEX "ScheduledJob_eventId_idx" ON "ScheduledJob"("eventId");
