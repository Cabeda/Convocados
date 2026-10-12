-- Persist the failure reason on a job so a dead-lettered ScheduledJob is
-- diagnosable from the row itself. The message previously lived only in stdout,
-- and the host keeps no log history, so a dead-letter could only be explained by
-- re-deriving the cause. Nullable: set on each failed attempt, cleared on success.
ALTER TABLE "ScheduledJob" ADD COLUMN "lastError" TEXT;
