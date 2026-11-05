-- Retirement: 2026-11-04 read-only production audit found zero watch/alert/hit
-- records and zero non-default Event provider metadata. The 45 availability
-- rows are disposable upstream-response cache entries, not games or bookings.
-- No Event, user, player, notification or game-history rows are deleted.
DROP TABLE "CourtWatchHit";
DROP TABLE "CourtWatch";
DROP TABLE "CourtWatchAlert";
DROP TABLE "PlaytomicAvailabilityCache";
DROP INDEX "Event_sourceKey_key";
DROP INDEX "Event_source_archivedAt_idx";
ALTER TABLE "Event" DROP COLUMN "courtWatchConfig";
ALTER TABLE "Event" DROP COLUMN "source";
ALTER TABLE "Event" DROP COLUMN "sourceKey";
ALTER TABLE "Event" DROP COLUMN "playtomicTenantId";
ALTER TABLE "Event" DROP COLUMN "playtomicTenantName";
ALTER TABLE "Event" DROP COLUMN "adoptedAt";
