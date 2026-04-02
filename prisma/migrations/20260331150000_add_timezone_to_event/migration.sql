-- Add timezone field to Event
ALTER TABLE "Event" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
