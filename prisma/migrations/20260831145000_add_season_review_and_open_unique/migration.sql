-- Add the documented result-review lifecycle timestamp.
ALTER TABLE "Season" ADD COLUMN "reviewStartedAt" DATETIME;

-- Keep the one non-terminal Season per Event invariant under concurrent writes.
CREATE UNIQUE INDEX "Season_one_open_per_event_key"
  ON "Season"("eventId")
  WHERE "status" NOT IN ('completed', 'cancelled');
