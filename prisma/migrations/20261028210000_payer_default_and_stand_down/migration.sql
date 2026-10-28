-- ADR 0055: an Event can propose a Payer for each Game, and a Payer can stand
-- down for one Game without erasing who the default is.
--
-- The Event fields only seed new Games. The Game keeps its own
-- payerEventPlayerId when the payer stands down; payerStoodDownAt marks the
-- role Vacant so the UI can ask the roster who is collecting.
ALTER TABLE "Event" ADD COLUMN "defaultPayerEventPlayerId" TEXT;
ALTER TABLE "Event" ADD COLUMN "defaultPayerExternalName" TEXT;
ALTER TABLE "Game" ADD COLUMN "payerStoodDownAt" DATETIME;
