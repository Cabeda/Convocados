-- Recruitment notification dedup (#538 follow-up)
-- The "missing players" / recruitment push was firing on every cron tick
-- within the 2-hour T-48h and T-24h windows, flooding non-playing followers.
-- These flags ensure each recruitment ping fires exactly once per occurrence
-- and are reset when the event advances to its next occurrence.

ALTER TABLE "Event" ADD COLUMN "recruitment48hSent" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN "recruitment24hSent" BOOLEAN NOT NULL DEFAULT false;
