-- AlterTable
ALTER TABLE "GamePayment" ADD COLUMN "archivedAt" DATETIME;

-- CreateIndex
CREATE INDEX "GamePayment_eventPlayerId_idx" ON "GamePayment"("eventPlayerId");
