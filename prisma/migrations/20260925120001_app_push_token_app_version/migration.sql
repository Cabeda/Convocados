-- Add appVersion to AppPushToken for native client heartbeat diagnostics
ALTER TABLE "AppPushToken" ADD COLUMN "appVersion" TEXT;