-- Add a provider/external reference to ledger rows so an online payment
-- webhook (e.g. Stripe) can record the charge/event it settled and be deduped.
ALTER TABLE "WalletTransaction" ADD COLUMN "externalId" TEXT;

CREATE INDEX "WalletTransaction_eventId_externalId_idx" ON "WalletTransaction"("eventId", "externalId");
