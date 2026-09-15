-- Season coexistence: registration Seasons may coexist (past recording,
-- future prep) as long as their registration windows do not overlap
-- (enforced in application code, date-only with exclusive edges).
-- The single-live-competition invariant stays at the DB level, narrowed from
-- "one non-terminal Season per Event" to "one active/review Season per Event"
-- so concurrent activations cannot create two live competitions.
DROP INDEX IF EXISTS "Season_one_open_per_event_key";
CREATE UNIQUE INDEX "Season_one_open_per_event_key"
  ON "Season"("eventId")
  WHERE "status" IN ('active', 'review');
