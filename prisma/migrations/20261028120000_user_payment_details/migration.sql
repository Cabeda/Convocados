-- Payment Details belong to the person owed the money (ADR 0055).
--
-- `paymentDetails` mirrors EventCost.paymentMethods: a JSON array of
-- { type, value, label? } validated by src/lib/paymentMethods.ts. Stored as a
-- string because SQLite has no JSON column type and the existing event-level
-- field is stored the same way.
--
-- `sharePaymentDetails` defaults to false: filling in a profile is not consent
-- to publish it to an Event's webhook subscribers.
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "paymentDetails" TEXT;
ALTER TABLE "User" ADD COLUMN "sharePaymentDetails" BOOLEAN NOT NULL DEFAULT false;
