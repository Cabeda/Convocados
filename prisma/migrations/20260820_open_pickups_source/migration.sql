ALTER TABLE "Event" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "Event" ADD COLUMN "sourceKey" TEXT;
ALTER TABLE "Event" ADD COLUMN "playtomicTenantId" TEXT;
ALTER TABLE "Event" ADD COLUMN "playtomicTenantName" TEXT;
CREATE UNIQUE INDEX "Event_sourceKey_key" ON "Event"("sourceKey");
CREATE INDEX "Event_source_archivedAt_idx" ON "Event"("source","archivedAt");
