-- Admin metrics: attribute each app-open heartbeat to the client that produced
-- it ("web" via middleware page navigation, "android"/"ios" via the native
-- POST /api/me/app-open). Null for rows written before this column existed.
ALTER TABLE "UserAppOpen" ADD COLUMN "platform" TEXT;
