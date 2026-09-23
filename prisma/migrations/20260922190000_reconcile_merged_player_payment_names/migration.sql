-- Follow-up to 20260922180000_backfill_merged_player_identity.
--
-- The first pass collapsed team snapshots but not the denormalized *payment*
-- names: `GamePayment.playerName` and the frozen `GameHistory.paymentsSnapshot`
-- JSON still carried the absorbed player's name, so history/balance views kept
-- showing it. `mergePlayerIdentity` now rewrites both going forward.
--
-- Enqueue the (idempotent) job again, under a new id, so the already-collapsed
-- rows on existing databases are reconciled. Runs automatically on deploy via
-- fly.toml's release_command (`prisma migrate deploy`).
INSERT INTO "ScheduledJob" ("id", "type", "payload", "runAt", "retryCount", "createdAt")
VALUES (
  'backfill-merged-player-identity-2',
  'backfill_merged_identity',
  '{}',
  CAST(strftime('%s', 'now') AS INTEGER) * 1000,
  0,
  CAST(strftime('%s', 'now') AS INTEGER) * 1000
);
