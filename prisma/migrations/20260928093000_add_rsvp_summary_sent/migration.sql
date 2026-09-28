-- Dedup flag for the T-24h organizer RSVP summary ("X confirmed, Y declined,
-- Z pending"). Without it the summary re-fired on every 5-minute cron tick
-- inside the T-24h ±1h window (spam: one push every 5 min for 2 hours).
ALTER TABLE "Event" ADD COLUMN "rsvpSummarySent" BOOLEAN NOT NULL DEFAULT false;
