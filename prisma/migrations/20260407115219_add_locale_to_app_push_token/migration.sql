-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AppPushToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'en',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AppPushToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AppPushToken" ("createdAt", "id", "platform", "token", "updatedAt", "userId") SELECT "createdAt", "id", "platform", "token", "updatedAt", "userId" FROM "AppPushToken";
DROP TABLE "AppPushToken";
ALTER TABLE "new_AppPushToken" RENAME TO "AppPushToken";
CREATE UNIQUE INDEX "AppPushToken_token_key" ON "AppPushToken"("token");
CREATE INDEX "AppPushToken_userId_idx" ON "AppPushToken"("userId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
