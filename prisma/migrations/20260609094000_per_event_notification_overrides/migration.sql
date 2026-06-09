-- Add per-event notification override columns to EventFollow
ALTER TABLE "EventFollow" ADD COLUMN "mutePlayerActivity" BOOLEAN;
ALTER TABLE "EventFollow" ADD COLUMN "muteReminders" BOOLEAN;
ALTER TABLE "EventFollow" ADD COLUMN "mutePostGame" BOOLEAN;
ALTER TABLE "EventFollow" ADD COLUMN "muteEventDetails" BOOLEAN;

-- Add dedicated postGamePush to NotificationPreferences (was incorrectly sharing gameReminderPush)
ALTER TABLE "NotificationPreferences" ADD COLUMN "postGamePush" BOOLEAN NOT NULL DEFAULT true;
