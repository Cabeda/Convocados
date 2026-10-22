-- The city the public listing filters by (#1445). Nullable: an event whose
-- location gave nothing to guess still lists, it is just not findable by city.
ALTER TABLE "Event" ADD COLUMN "city" TEXT;
