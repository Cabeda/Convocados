-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Game" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "dateTime" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'upcoming',
    "isFriendly" BOOLEAN NOT NULL DEFAULT false,
    "scoreOne" INTEGER,
    "scoreTwo" INTEGER,
    "teamOneName" TEXT,
    "teamTwoName" TEXT,
    "eloProcessed" BOOLEAN NOT NULL DEFAULT false,
    "rsvpCutoffSent" BOOLEAN NOT NULL DEFAULT false,
    "costTotalAmount" REAL,
    "costCurrency" TEXT,
    "paymentMode" TEXT DEFAULT 'tracked',
    "payerEventPlayerId" TEXT,
    "payerExternalName" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Game_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Game_payerEventPlayerId_fkey" FOREIGN KEY ("payerEventPlayerId") REFERENCES "EventPlayer" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Game" ("costCurrency", "costTotalAmount", "createdAt", "dateTime", "eloProcessed", "eventId", "id", "isFriendly", "rsvpCutoffSent", "scoreOne", "scoreTwo", "status", "teamOneName", "teamTwoName", "updatedAt") SELECT "costCurrency", "costTotalAmount", "createdAt", "dateTime", "eloProcessed", "eventId", "id", "isFriendly", "rsvpCutoffSent", "scoreOne", "scoreTwo", "status", "teamOneName", "teamTwoName", "updatedAt" FROM "Game";
DROP TABLE "Game";
ALTER TABLE "new_Game" RENAME TO "Game";
CREATE INDEX "Game_eventId_dateTime_idx" ON "Game"("eventId", "dateTime");
CREATE INDEX "Game_eventId_status_idx" ON "Game"("eventId", "status");
CREATE INDEX "Game_payerEventPlayerId_idx" ON "Game"("payerEventPlayerId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
