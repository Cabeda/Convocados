-- Reminder Timings: per-event selection of which pre-game reminders exist
-- (24h/2h/1h). Gates every channel — a disabled timing emits no push, email
-- or webhook. Backfill existing rows all-on (every timing fired before this
-- change, so behavior is preserved); new rows default to 24h+2h, matching the
-- user-level reminder pref defaults.
ALTER TABLE "Event" ADD COLUMN "reminder24h" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Event" ADD COLUMN "reminder2h" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Event" ADD COLUMN "reminder1h" BOOLEAN NOT NULL DEFAULT false;
UPDATE "Event" SET "reminder1h" = true;

-- muteReminders (coarse all-reminders mute in notificationDefaults) is
-- superseded by Reminder Timings. Events that muted reminders get every
-- timing disabled; the retired key is stripped from the JSON blob so it can't
-- be mistaken for live config.
UPDATE "Event"
SET "reminder24h" = false, "reminder2h" = false, "reminder1h" = false
WHERE "notificationDefaults" LIKE '%"muteReminders":true%';

UPDATE "Event"
SET "notificationDefaults" = json_remove("notificationDefaults", '$.muteReminders')
WHERE "notificationDefaults" IS NOT NULL
  AND json_valid("notificationDefaults")
  AND "notificationDefaults" LIKE '%"muteReminders"%';
