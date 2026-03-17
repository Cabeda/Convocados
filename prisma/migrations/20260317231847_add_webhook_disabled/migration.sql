-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_WebhookSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "eventId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT,
    "events" TEXT NOT NULL DEFAULT '[]',
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebhookSubscription_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_WebhookSubscription" ("createdAt", "eventId", "events", "id", "secret", "url") SELECT "createdAt", "eventId", "events", "id", "secret", "url" FROM "WebhookSubscription";
DROP TABLE "WebhookSubscription";
ALTER TABLE "new_WebhookSubscription" RENAME TO "WebhookSubscription";
CREATE UNIQUE INDEX "WebhookSubscription_eventId_url_key" ON "WebhookSubscription"("eventId", "url");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
