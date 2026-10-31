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

import { hashPassword, buildAccessCookie } from "~/lib/eventAccess";
import { POST as claim } from "~/pages/api/events/[id]/payments/payer/claim";
import { POST as standDown } from "~/pages/api/events/[id]/payments/payer/stand-down";
import { GET as getPayer } from "~/pages/api/events/[id]/payments/payer/index";

const CTX = (id: string, body: unknown = {}) =>
  ({
    params: { id },
    request: new Request("http://localhost/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  }) as any;

const GET_CTX = (id: string, cookie?: string) =>
  ({
    params: { id },
    request: new Request("http://localhost/x", {
      method: "GET",
      headers: cookie ? { cookie } : {},
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
  await testPrisma.gameParticipant.create({
    data: { gameId: game.id, eventPlayerId: anaPlayer.id, order: 0 },
  });
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

  it("refuses a player who has left the active roster", async () => {
    const { event, game, ana } = await seed();
    await testPrisma.gameParticipant.updateMany({
      where: { gameId: game.id },
      data: { archivedAt: new Date() },
    });
    mockGetSession.mockResolvedValue({ user: { id: ana.id } });

    const res = await claim(CTX(event.id));
    expect(res.status).toBe(403);
  });

  it("refuses a played Game id and leaves its settled payer untouched", async () => {
    const { event, ana, anaPlayer } = await seed();
    const oldGame = await testPrisma.game.create({
      data: {
        id: `pc-old-${Date.now()}`,
        eventId: event.id,
        dateTime: new Date("2026-10-20T20:00:00Z"),
        status: "played",
        payerEventPlayerId: anaPlayer.id,
      },
    });
    const oldPayment = await testPrisma.gamePayment.create({
      data: {
        gameId: oldGame.id,
        eventPlayerId: anaPlayer.id,
        playerName: "Ana",
        amount: 10,
        status: "paid",
        method: "payer",
        paidAt: new Date(),
      },
    });
    mockGetSession.mockResolvedValue({ user: { id: ana.id } });

    const res = await claim(CTX(event.id, { gameId: oldGame.id }));
    expect(res.status).toBe(400);

    const after = await testPrisma.gamePayment.findUnique({ where: { id: oldPayment.id } });
    expect(after!.status).toBe("paid");
    expect(after!.method).toBe("payer");
    const oldAfter = await testPrisma.game.findUnique({ where: { id: oldGame.id } });
    expect(oldAfter!.payerEventPlayerId).toBe(anaPlayer.id);
  });

  it("does not turn an untracked Game into a tracked one", async () => {
    const { event, game, ana } = await seed();
    await testPrisma.game.update({ where: { id: game.id }, data: { paymentMode: "untracked" } });
    mockGetSession.mockResolvedValue({ user: { id: ana.id } });

    const res = await claim(CTX(event.id));
    expect(res.status).toBe(400);

    const after = await testPrisma.game.findUnique({ where: { id: game.id } });
    expect(after!.paymentMode).toBe("untracked");
    expect(await testPrisma.gamePayment.count({ where: { gameId: game.id } })).toBe(0);
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

describe("GET payer/index", () => {
  it("returns the current game's payer summary", async () => {
    const { event, game, ana } = await seed();
    await testPrisma.eventCost.create({
      data: { eventId: event.id, totalAmount: 60, currency: "EUR" },
    });
    mockGetSession.mockResolvedValue({ user: { id: ana.id } });

    const res = await getPayer(GET_CTX(event.id));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.gameId).toBe(game.id);
    expect(json.mode).toBe("tracked");
    expect(json.hasCost).toBe(true);
    expect(json.payerName).toBe("Ana");
    expect(json.isPayer).toBe(true);
    expect(json.isRosterPlayer).toBe(true);
    expect(json.vacant).toBe(false);
  });

  it("reports a vacant payer after a stand-down", async () => {
    const { event, ana } = await seed();
    mockGetSession.mockResolvedValue({ user: { id: ana.id } });
    await standDown(CTX(event.id));

    const json = await (await getPayer(GET_CTX(event.id))).json();
    expect(json.vacant).toBe(true);
    expect(json.isPayer).toBe(false);
    expect(json.payerName).toBe("Ana"); // who may pick it back up
  });

  it("returns a null game when the event has none", async () => {
    const { event, ana } = await seed();
    await testPrisma.event.update({ where: { id: event.id }, data: { currentGameId: null } });
    mockGetSession.mockResolvedValue({ user: { id: ana.id } });

    const json = await (await getPayer(GET_CTX(event.id))).json();
    expect(json.gameId).toBeNull();
    expect(json.payerName).toBeNull();
    expect(json.isPayer).toBe(false);
  });

  it("refuses an unauthenticated caller", async () => {
    const { event } = await seed();
    mockGetSession.mockResolvedValue(null);

    const res = await getPayer(GET_CTX(event.id));
    expect(res.status).toBe(401);
  });

  it("denies a non-member on a locked Event and allows a roster player with the access cookie", async () => {
    const { event, ana, outsider } = await seed();
    const accessPassword = hashPassword("secret");
    await testPrisma.event.update({ where: { id: event.id }, data: { accessPassword } });

    mockGetSession.mockResolvedValue({ user: { id: outsider.id } });
    const denied = await getPayer(GET_CTX(event.id));
    expect(denied.status).toBe(403);
    expect((await denied.json()).locked).toBe(true);

    const cookie = buildAccessCookie(null, event.id, accessPassword);
    mockGetSession.mockResolvedValue({ user: { id: ana.id } });
    const allowed = await getPayer(GET_CTX(event.id, cookie));
    expect(allowed.status).toBe(200);
    expect((await allowed.json()).payerName).toBe("Ana");
  });
});
