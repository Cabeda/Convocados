-- One-click email unsubscribe: per-user token embedded in email footer links,
-- validated by /api/unsubscribe without requiring a login.
ALTER TABLE "User" ADD COLUMN "emailUnsubscribeToken" TEXT;
CREATE UNIQUE INDEX "User_emailUnsubscribeToken_key" ON "User"("emailUnsubscribeToken");
