import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { postLedgerEntry } from "~/lib/ledger.server";

let eventId = "";
let userId = "";

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  const user = await prisma.user.create({
    data: { id: `u-${Date.now()}`, name: "Payer", email: `p-${Date.now()}@test.com`, emailVerified: false },
  });
  userId = user.id;
  const event = await prisma.event.create({
    data: { title: "Ledger", location: "P", dateTime: new Date(), teamOneName: "A", teamTwoName: "B" },
  });
  eventId = event.id;
});

const entry = () => ({
  eventId,
  userId,
  amountCents: 3000,
  currency: "EUR",
  direction: "credit" as const,
  reason: "payment_received" as const,
  eventInstanceId: "game-1",
  statusAfter: "paid",
  idempotencyKey: `received:${eventId}:${userId}:game-1`,
  externalId: "pi_123",
});

describe("postLedgerEntry", () => {
  it("writes a ledger row and reports it was not deduped", async () => {
    const result = await postLedgerEntry(entry());
    expect(result.deduped).toBe(false);
    const row = await prisma.walletTransaction.findUnique({ where: { id: result.id } });
    expect(row).toMatchObject({ amountCents: 3000, reason: "payment_received", externalId: "pi_123" });
  });

  it("is idempotent: the same key never writes twice (webhook retries)", async () => {
    const first = await postLedgerEntry(entry());
    const second = await postLedgerEntry(entry());
    expect(second.deduped).toBe(true);
    expect(second.id).toBe(first.id);
    expect(await prisma.walletTransaction.count()).toBe(1);
  });

  it("creates a new row when no key is supplied", async () => {
    await postLedgerEntry({ ...entry(), idempotencyKey: null });
    await postLedgerEntry({ ...entry(), idempotencyKey: null });
    expect(await prisma.walletTransaction.count()).toBe(2);
  });
});
