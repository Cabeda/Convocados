-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_GameHistory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "dateTime" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'played',
    "scoreOne" INTEGER,
    "scoreTwo" INTEGER,
    "teamOneName" TEXT NOT NULL,
    "teamTwoName" TEXT NOT NULL,
    "teamsSnapshot" TEXT,
    "paymentsSnapshot" TEXT,
    "editableUntil" DATETIME NOT NULL,
    "eloProcessed" BOOLEAN NOT NULL DEFAULT false,
    "source" TEXT NOT NULL DEFAULT 'live',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "GameHistory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_GameHistory" ("createdAt", "dateTime", "editableUntil", "eloProcessed", "eventId", "id", "paymentsSnapshot", "scoreOne", "scoreTwo", "status", "teamOneName", "teamTwoName", "teamsSnapshot") SELECT "createdAt", "dateTime", "editableUntil", "eloProcessed", "eventId", "id", "paymentsSnapshot", "scoreOne", "scoreTwo", "status", "teamOneName", "teamTwoName", "teamsSnapshot" FROM "GameHistory";
DROP TABLE "GameHistory";
ALTER TABLE "new_GameHistory" RENAME TO "GameHistory";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
