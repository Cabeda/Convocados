-- OpenSkill posterior (mu, sigma) behind the projected scalar `rating`.
-- Nullable: existing rows are seeded lazily from `rating` on the next recompute.
ALTER TABLE "PlayerRating" ADD COLUMN "ratingMu" REAL;
ALTER TABLE "PlayerRating" ADD COLUMN "ratingSigma" REAL;

ALTER TABLE "EventPlayer" ADD COLUMN "ratingMu" REAL;
ALTER TABLE "EventPlayer" ADD COLUMN "ratingSigma" REAL;
