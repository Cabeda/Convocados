-- Skill Rating is now an owner/admin-only tool; the visible ladder is Season
-- Rank. Showing raw ELO in team views confused players, so hide it by default.
-- Backfill existing events (the Prisma client default only covers new rows).
UPDATE "Event" SET "hideEloInTeams" = true;
