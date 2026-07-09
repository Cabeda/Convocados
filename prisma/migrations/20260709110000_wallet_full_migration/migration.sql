-- Add gameHistoryId and playerName to WalletTransaction (ADR 0019)
-- All additive: nullable columns + indexes. No data loss.

-- AlterTable
ALTER TABLE "WalletTransaction" ADD COLUMN "gameHistoryId" TEXT;
ALTER TABLE "WalletTransaction" ADD COLUMN "playerName" TEXT;

-- CreateIndex
CREATE INDEX "WalletTransaction_gameHistoryId_idx" ON "WalletTransaction"("gameHistoryId");
CREATE INDEX "WalletTransaction_eventId_userId_gameHistoryId_idx" ON "WalletTransaction"("eventId", "userId", "gameHistoryId");
CREATE INDEX "WalletTransaction_playerName_idx" ON "WalletTransaction"("playerName");

-- AddForeignKey
-- (no FK constraint on gameHistoryId: ON DELETE SET NULL is the desired behaviour, but SQLite
--  doesn't natively support ON DELETE SET NULL for nullable FKs the way Postgres does. We
--  handle the cascade in application code in the backfill script and in deleteGameHistory.)
