-- CreateTable
CREATE TABLE "CalendarToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'user',
    "scopeId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CalendarToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "CalendarToken_token_key" ON "CalendarToken"("token");

-- CreateIndex
CREATE INDEX "CalendarToken_userId_idx" ON "CalendarToken"("userId");

-- CreateIndex
CREATE INDEX "CalendarToken_token_idx" ON "CalendarToken"("token");
