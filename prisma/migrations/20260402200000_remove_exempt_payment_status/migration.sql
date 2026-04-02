-- Migrate all "exempt" payment statuses to "paid"
UPDATE "PlayerPayment" SET status = 'paid' WHERE status = 'exempt';
