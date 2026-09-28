-- Atomic claim for ScheduledJob (scheduler deepening): one worker wins the
-- guarded update before side effects run; the lease expires so a crashed
-- worker's job is redelivered instead of lost.
ALTER TABLE "ScheduledJob" ADD COLUMN "claimedAt" DATETIME;
ALTER TABLE "ScheduledJob" ADD COLUMN "claimedBy" TEXT;
