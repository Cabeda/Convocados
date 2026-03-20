-- CreateTable
CREATE TABLE "EventLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT,
    "actorId" TEXT,
    "details" TEXT NOT NULL DEFAULT '{}',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EventLog_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "EventLog_eventId_createdAt_idx" ON "EventLog"("eventId", "createdAt");
