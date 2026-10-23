-- Roster positions are opt-in (#1448): a group that does not use them is never
-- asked for one.
ALTER TABLE "Event" ADD COLUMN "positionsEnabled" BOOLEAN NOT NULL DEFAULT false;
