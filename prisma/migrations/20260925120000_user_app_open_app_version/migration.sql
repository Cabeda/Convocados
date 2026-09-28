-- Diagnostics: store the native app version (e.g. "1.2.0") with each heartbeat.
-- Null for web clients and older native builds. Not PII — version string only.
ALTER TABLE "UserAppOpen" ADD COLUMN "appVersion" TEXT;