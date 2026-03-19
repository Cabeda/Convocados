-- AlterTable
ALTER TABLE "GameHistory" ADD COLUMN "paymentsSnapshot" TEXT;

-- CreateTable
CREATE TABLE "EventCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "totalAmount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentDetails" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventCost_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlayerPayment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventCostId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "method" TEXT,
    "paidAt" DATETIME,
    "markedBy" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PlayerPayment_eventCostId_fkey" FOREIGN KEY ("eventCostId") REFERENCES "EventCost" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "EventCost_eventId_key" ON "EventCost"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerPayment_eventCostId_playerName_key" ON "PlayerPayment"("eventCostId", "playerName");
