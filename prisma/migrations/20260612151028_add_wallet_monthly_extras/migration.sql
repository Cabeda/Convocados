-- CreateTable
CREATE TABLE "MonthlySubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'monthly',
    "windowStart" DATETIME NOT NULL,
    "windowEnd" DATETIME NOT NULL,
    "feeCents" INTEGER NOT NULL,
    "gamesCovered" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "markedById" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MonthlySubscription_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MonthlySubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "WalletTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "gameUnits" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "statusAfter" TEXT,
    "eventInstanceId" TEXT,
    "subscriptionId" TEXT,
    "extrasId" TEXT,
    "idempotencyKey" TEXT,
    "markedById" TEXT,
    "note" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WalletTransaction_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WalletTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExtrasDeclaration" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "declaredBy" TEXT NOT NULL,
    "declaredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ExtrasDeclaration_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_EventCost" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "totalAmount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EUR',
    "paymentDetails" TEXT,
    "paymentMethods" TEXT,
    "tempPaymentMethods" TEXT,
    "tempPaymentDetails" TEXT,
    "monthlyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "monthlyFeeCents" INTEGER,
    "monthlyGamesCovered" INTEGER NOT NULL DEFAULT 5,
    "dropInSurchargeCents" INTEGER NOT NULL DEFAULT 0,
    "organizerExtrasCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "EventCost_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_EventCost" ("createdAt", "currency", "eventId", "id", "paymentDetails", "paymentMethods", "tempPaymentDetails", "tempPaymentMethods", "totalAmount", "updatedAt") SELECT "createdAt", "currency", "eventId", "id", "paymentDetails", "paymentMethods", "tempPaymentDetails", "tempPaymentMethods", "totalAmount", "updatedAt" FROM "EventCost";
DROP TABLE "EventCost";
ALTER TABLE "new_EventCost" RENAME TO "EventCost";
CREATE UNIQUE INDEX "EventCost_eventId_key" ON "EventCost"("eventId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "MonthlySubscription_eventId_windowStart_idx" ON "MonthlySubscription"("eventId", "windowStart");

-- CreateIndex
CREATE INDEX "MonthlySubscription_userId_idx" ON "MonthlySubscription"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "MonthlySubscription_eventId_userId_windowStart_key" ON "MonthlySubscription"("eventId", "userId", "windowStart");

-- CreateIndex
CREATE INDEX "WalletTransaction_eventId_userId_createdAt_idx" ON "WalletTransaction"("eventId", "userId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_eventId_createdAt_idx" ON "WalletTransaction"("eventId", "createdAt");

-- CreateIndex
CREATE INDEX "WalletTransaction_eventInstanceId_idx" ON "WalletTransaction"("eventInstanceId");

-- CreateIndex
CREATE UNIQUE INDEX "WalletTransaction_idempotencyKey_key" ON "WalletTransaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "ExtrasDeclaration_eventId_declaredAt_idx" ON "ExtrasDeclaration"("eventId", "declaredAt");
