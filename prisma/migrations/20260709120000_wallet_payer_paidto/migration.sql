-- Add payerUserId + paidToUserId to WalletTransaction (ADR 0019 rev)
-- All additive: nullable columns + indexes. No data loss.

-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN "payerUserId" TEXT;
ALTER TABLE "WalletTransaction" ADD COLUMN "paidToUserId" TEXT;

-- CreateIndex
CREATE INDEX "WalletTransaction_payerUserId_idx" ON "WalletTransaction"("payerUserId");
CREATE INDEX "WalletTransaction_paidToUserId_idx" ON "WalletTransaction"("paidToUserId");
