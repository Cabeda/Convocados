-- Season Rank is re-denominated in Rank Points (whole ladder x10) and payouts
-- are now clamped. Frozen calibration edges and completion snapshots are in the
-- old unit; clear them so they re-derive on next read (ensureRankCalibration
-- re-derives when rankTierEdges is NULL).
UPDATE "Event" SET "rankTierEdges" = NULL;
DELETE FROM "SeasonRankSnapshot";
