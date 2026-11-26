-- Notification outbox lease (#1735): a claim is a lease, not a delivery.
-- A row claimed by a worker that dies before sending becomes reclaimable once
-- claimedAt is older than the lease, instead of being invisible forever.
ALTER TABLE "NotificationJob" ADD COLUMN "claimedAt" DATETIME;
ALTER TABLE "NotificationJob" ADD COLUMN "claimedBy" TEXT;
ALTER TABLE "NotificationJob" ADD COLUMN "reclaimedAt" DATETIME;
