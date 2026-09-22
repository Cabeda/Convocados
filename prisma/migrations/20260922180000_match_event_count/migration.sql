-- A Match Event can represent more than one goal: "player X scored 3" is a
-- single row carrying count=3, so a high-scoring game does not need one entry
-- per goal. Existing rows are one goal each.
ALTER TABLE "MatchEvent" ADD COLUMN "count" INTEGER NOT NULL DEFAULT 1;
