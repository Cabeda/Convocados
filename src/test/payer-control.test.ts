import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient();

const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: async () => ({ isOwner: false, isAdmin: false, session: null }),
}));
vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: async () => null,
}));
vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("~/lib/db.server", async () => {
  const { PrismaClient: PC } = await import("~/lib/prisma-client");
  const p = new PC();
  return { prisma: p };
});
vi.mock("~/lib/webhook.server", () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }));

import { POST as claim } from "~/pages/api/events/[id]/payments/payer/claim";
import { POST as standDown } from "~/pages/api/events/[id]/payments/payer/stand-down";

const CTX = (id: string, body: unknown = {}) =>
  ({
    params: { id },
    request: new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  }) as any;

async function seed() {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const owner = await testPrisma.user.create({
    data: { id: `pc-owner-${stamp}`, name: "Owner", email: `o-${stamp}@example.com` },
  });
  const ana = await testPrisma.user.create({
    data: { id: `pc-ana-${stamp}`, name: "Ana", email: `a-${stamp}@example.com` },
  });
  const outsider = await testPrisma.user.create({
    data: { id: `pc-out-${stamp}`, name: "Out", email: `x-${stamp}@example.com` },
  });
  const event = await testPrisma.event.create({
    data: {
      id: `pc-e-${stamp}`,
      title: "Tuesday",
      dateTime: new Date("2026-10-27T20:00:00Z"),
      location: "Pitch",
      maxPlayers: 10,
      ownerId: owner.id,
    },
  });
  const anaPlayer = await testPrisma.eventPlayer.create({
    data: { id: `pc-ep-${stamp}`, eventId: event.id, name: "Ana", userId: ana.id },
  });
  const game = await testPrisma.game.create({
    data: {
      id: `pc-g-${stamp}`,
      eventId: event.id,
      dateTime: new Date("2026-10-27T20:00:00Z"),
      status: "upcoming",
      paymentMode: "tracked",
      payerEventPlayerId: anaPlayer.id,
    },
  });
  await testPrisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { event, game, ana, outsider, owner, anaPlayer };
}

beforeEach(async () => {
  await testPrisma.game.deleteMany({ where: { id: { startsWith: "pc-g-" } } });
  await testPrisma.eventPlayer.deleteMany({ where: { id: { startsWith: "pc-ep-" } } });
  await testPrisma.event.deleteMany({ where: { id: { startsWith: "pc-e-" } } });
  await testPrisma.user.deleteMany({ where: { id: { startsWith: "pc-" } } });
  mockGetSession.mockReset();
});

describe("POST payer/claim", () => {
  it("lets a roster player claim the role for the current game", async () => {
    const { event, game, ana } = await seed();
    await testPrisma.game.update({ where: { id: game.id }, data: { payerEventPlayerId: null } });
    mockGetSession.mockResolvedValue({ user: { id: ana.id } });

    const res = await claim(CTX(event.id));
    expect(res.status).toBe(200);

    const updated = await testPrisma.game.findUnique({ where: { id: game.id } });
    expect(updated!.payerEventPlayerId).toBeTruthy();
  });

  it("refuses someone who is not on the roster", async () => {
    const { event, outsider } = await seed();
    mockGetSession.mockResolvedValue({ user: { id: outsider.id } });

    const res = await claim(CTX(event.id));
    expect(res.status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    const { event } = await seed();
    mockGetSession.mockResolvedValue(null);

    const res = await claim(CTX(event.id));
    expect(res.status).toBe(401);
  });
});

describe("POST payer/stand-down", () => {
  it("keeps the payer id and marks the game vacant", async () => {
    const { event, game, ana, anaPlayer } = await seed();
    mockGetSession.mockResolvedValue({ user: { id: ana.id } });

    const res = await standDown(CTX(event.id));
    expect(res.status).toBe(200);

    const updated = await testPrisma.game.findUnique({ where: { id: game.id } });
    expect(updated!.payerEventPlayerId).toBe(anaPlayer.id);
    expect(updated!.payerStoodDownAt).toBeInstanceOf(Date);
  });

  it("refuses a roster player who is not the payer", async () => {
    const { event, outsider } = await seed();
    const outsiderPlayer = await testPrisma.eventPlayer.findFirst({
      where: { eventId: event.id, userId: outsider.id },
    });
    if (!outsiderPlayer) {
      await testPrisma.eventPlayer.create({
        data: { id: `pc-ep-out-${Date.now()}`, eventId: event.id, name: "Out", userId: outsider.id },
      });
    }
    mockGetSession.mockResolvedValue({ user: { id: outsider.id } });

    const res = await standDown(CTX(event.id));
    expect(res.status).toBe(403);
  });

  it("clears a stand-down when a payer is set again", async () => {
    const { event, game, ana, anaPlayer } = await seed();
    await testPrisma.game.update({ where: { id: game.id }, data: { payerStoodDownAt: new Date() } });
    mockGetSession.mockResolvedValue({ user: { id: ana.id } });

    await claim(CTX(event.id));
    const updated = await testPrisma.game.findUnique({ where: { id: game.id } });
    expect(updated!.payerEventPlayerId).toBe(anaPlayer.id);
    expect(updated!.payerStoodDownAt).toBeNull();
  });
});
