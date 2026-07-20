-- ADR 0019: Per-Game cost override (null = inherit from EventCost template)
ALTER TABLE "Game" ADD COLUMN "costTotalAmount" REAL;
ALTER TABLE "Game" ADD COLUMN "costCurrency" TEXT;
