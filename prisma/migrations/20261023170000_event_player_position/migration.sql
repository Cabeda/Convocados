-- Optional player preference: GK | DEF | MID | FWD (#1448). Nullable: a player
-- may have none, and nothing enforces a formation.
ALTER TABLE "EventPlayer" ADD COLUMN "position" TEXT;
