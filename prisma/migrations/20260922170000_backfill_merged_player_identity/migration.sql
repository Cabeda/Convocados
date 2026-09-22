-- Cross-account merges (ADR 0040) repointed `userId` but left player identity
-- split, because identity is name-keyed (ADR 0016: EventPlayer / PlayerRating /
-- Player are @@unique([eventId, name]) and GameHistory.teamsSnapshot stores
-- names). A merged user could therefore still appear as two players in stats
-- and rankings (e.g. "José Cabeda" vs "Cabeda").
--
-- `mergeUsers` now collapses these at merge time. This enqueues a one-shot job
-- so the app repairs the merges that already happened — the collapse is safe in
-- SQL, but rebuilding the affected ELO ratings needs the app's replay logic, so
-- it runs in the app via the scheduler.
--
-- Runs automatically on deploy: fly.toml `release_command` (scripts/release-migrate.sh)
-- runs `prisma migrate deploy` before the new version takes traffic. The job is
-- idempotent and a no-op when nothing is split.
INSERT INTO "ScheduledJob" ("id", "type", "payload", "runAt", "retryCount", "createdAt")
VALUES (
  'backfill-merged-player-identity',
  'backfill_merged_identity',
  '{}',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  0,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);
