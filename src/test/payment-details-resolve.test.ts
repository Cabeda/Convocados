import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient();

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("~/lib/db.server", async () => {
  const { PrismaClient: PC } = await import("~/lib/prisma-client");
  const p = new PC();
  return { prisma: p };
});

import { resolvePaymentDetails } from "~/lib/paymentDetailsResolve.server";

const TEMP = JSON.stringify([{ type: "revolut_tag", value: "temp" }]);
const EVENT = JSON.stringify([{ type: "mbway", value: "911111111" }]);
const PAYER = JSON.stringify([{ type: "revolut_tag", value: "ana" }]);

async function seed(opts: {
  temp?: string | null;
  event?: string | null;
  payerDetails?: string | null;
  shared?: boolean;
  linked?: boolean;
}) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await testPrisma.user.create({
    data: { id: `u-owner-${stamp}`, name: "Owner", email: `owner-${stamp}@example.com` },
  });
  const payer = opts.linked === false
    ? null
    : await testPrisma.user.create({
        data: {
          id: `u-payer-${stamp}`,
          name: "Ana",
          email: `payer-${stamp}@example.com`,
          paymentDetails: opts.payerDetails ?? null,
          sharePaymentDetails: opts.shared ?? false,
        },
      });

  const event = await testPrisma.event.create({
    data: {
      id: `e-${stamp}`,
      title: "Tuesday",
      dateTime: new Date("2026-10-27T20:00:00Z"),
      location: "Pitch",
      maxPlayers: 10,
      ownerId: owner.id,
    },
  });
  await testPrisma.eventCost.create({
    data: { eventId: event.id, totalAmount: 50, currency: "EUR", paymentMethods: opts.event ?? null, tempPaymentMethods: opts.temp ?? null },
  });
  const eventPlayer = await testPrisma.eventPlayer.create({
    data: { id: `ep-${stamp}`, eventId: event.id, name: "Ana", userId: payer?.id ?? null },
  });
  const game = await testPrisma.game.create({
    data: {
      id: `g-${stamp}`,
      eventId: event.id,
      dateTime: new Date("2026-10-27T20:00:00Z"),
      status: "played",
      paymentMode: "tracked",
      payerEventPlayerId: eventPlayer.id,
    },
  });
  return { gameId: game.id, eventId: event.id, payerId: payer?.id };
}

beforeEach(async () => {
  await testPrisma.game.deleteMany({ where: { id: { startsWith: "g-" } } });
  await testPrisma.eventPlayer.deleteMany({ where: { id: { startsWith: "ep-" } } });
  await testPrisma.eventCost.deleteMany({ where: { eventId: { startsWith: "e-" } } });
  await testPrisma.event.deleteMany({ where: { id: { startsWith: "e-" } } });
  await testPrisma.user.deleteMany({ where: { id: { startsWith: "u-" } } });
});

describe("resolvePaymentDetails", () => {
  it("prefers the per-occurrence temporary override over everything", async () => {
    const { eventId, gameId } = await seed({ temp: TEMP, event: EVENT, payerDetails: PAYER, shared: true });
    const resolved = await resolvePaymentDetails(eventId, gameId);
    expect(resolved.source).toBe("temp_override");
    expect(resolved.methods).toEqual([{ type: "revolut_tag", value: "temp" }]);
  });

  it("uses the payer's own details when they are shared", async () => {
    const { eventId, gameId } = await seed({ event: EVENT, payerDetails: PAYER, shared: true });
    const resolved = await resolvePaymentDetails(eventId, gameId);
    expect(resolved.source).toBe("payer");
    expect(resolved.methods).toEqual([{ type: "revolut_tag", value: "ana" }]);
  });

  it("falls back to the event details when the payer has not consented", async () => {
    const { eventId, gameId } = await seed({ event: EVENT, payerDetails: PAYER, shared: false });
    const resolved = await resolvePaymentDetails(eventId, gameId);
    expect(resolved.source).toBe("event");
    expect(resolved.methods).toEqual([{ type: "mbway", value: "911111111" }]);
  });

  it("falls back when the payer is an external name with no account", async () => {
    const { eventId, gameId } = await seed({ event: EVENT, linked: false });
    const resolved = await resolvePaymentDetails(eventId, gameId);
    expect(resolved.source).toBe("event");
  });

  it("returns nothing when no source has any details", async () => {
    const { eventId, gameId } = await seed({});
    const resolved = await resolvePaymentDetails(eventId, gameId);
    expect(resolved).toEqual({ methods: [], source: "none" });
  });
});
