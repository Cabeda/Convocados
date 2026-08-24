-- ADR 0025 follow-up: persist which notification channels an invite was sent via
-- so admins can see delivery channels per invite and resend with a 24h cooldown.
ALTER TABLE "PlayerInvite" ADD COLUMN "sentViaEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlayerInvite" ADD COLUMN "sentViaWebPush" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "PlayerInvite" ADD COLUMN "sentViaAppPush" BOOLEAN NOT NULL DEFAULT false;
