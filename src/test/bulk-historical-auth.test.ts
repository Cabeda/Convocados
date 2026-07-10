/**
 * Authorization for "Mark debt as settled" on the SettleUp page.
 *
 * Rule: only the person RECEIVING the money (the creditor) or the event
 * admin/owner can mark a debt as settled. The DEBTOR cannot settle their
 * own debt — that would let any player "pay" themselves.
 *
 * The bulk endpoint at POST /api/events/[id]/payments/historical/bulk
 * accepts an optional `creditorName`. When present, the settlement is
 * authorized if:
 *   - the caller is the event owner / admin, OR
 *   - the caller's EventPlayer.name in this event matches creditorName
 *     (i.e. the caller is the creditor).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/payments/historical/bulk";
import { checkOwnership, getSession } from "~/lib/auth.helpers.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
  checkOwnership: vi.fn(),
}));

vi.mock("~/lib/eventLog.server", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

const mockCheckOwnership = vi.mocked(checkOwnership);
const mockGetSession = vi.mocked(getSession);

function mockSession(userId: string | null) {
  if (userId === null) {
    mockGetSession.mockResolvedValue(null);
  } else {
    mockGetSession.mockResolvedValue({
      user: { id: userId, name: "X", email: "x@t.com" },
      session: { id: "s1", userId, expiresAt: new Date() },
    } as any);
  }
}

beforeEach(async () => {
  await prisma.walletTransaction.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany({ where: { id: { startsWith: "ghost:" } } });
  await prisma.user.deleteMany();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

describe("POST /payments/historical/bulk — authorization", () => {
  it("allows admin/owner to settle any player's debts", async () => {
    mockCheckOwnership.mockResolvedValue({ isOwner: true, isAdmin: false, session: null } as any);
    mockSession(null);

    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "o@t.com", emailVerified: true } });
    const event = await prisma.event.create({
      data: { id: "evt-1", title: "Game", dateTime: new Date(), ownerId: owner.id, maxPlayers: 10, location: "Field" },
    });

    const req = new Request("http://localhost/api/events/evt-1/payments/historical/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerName: "Pai" }),
    });
    const res = await POST({ params: { id: "evt-1" }, request: req } as any);
    expect(res.status).toBe(200);
  });

  it("rejects a non-admin non-creditor (e.g. the debtor themselves)", async () => {
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    // Pai is the caller. Pai is the DEBTOR (the one whose debt would be settled).
    // Pai is NOT the creditor (José is). So Pai should be rejected.
    const pai = await prisma.user.create({ data: { id: "u-pai", name: "Pai", email: "p@t.com", emailVerified: true } });
    const jose = await prisma.user.create({ data: { id: "u-jose", name: "José", email: "j@t.com", emailVerified: true } });
    const event = await prisma.event.create({
      data: { id: "evt-1", title: "Game", dateTime: new Date(), maxPlayers: 10, location: "Field" },
    });
    // Pai and José are both players in the event.
    const paiEp = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Pai", userId: pai.id } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "José", userId: jose.id } });
    void paiEp;

    mockSession("u-pai");
    const req = new Request("http://localhost/api/events/evt-1/payments/historical/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerName: "Pai", creditorName: "José" }),
    });
    const res = await POST({ params: { id: "evt-1" }, request: req } as any);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/creditor|owner/i);
  });

  it("allows the creditor themselves to settle debts owed to them", async () => {
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    const pai = await prisma.user.create({ data: { id: "u-pai", name: "Pai", email: "p@t.com", emailVerified: true } });
    const jose = await prisma.user.create({ data: { id: "u-jose", name: "José", email: "j@t.com", emailVerified: true } });
    const event = await prisma.event.create({
      data: { id: "evt-1", title: "Game", dateTime: new Date(), maxPlayers: 10, location: "Field" },
    });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Pai", userId: pai.id } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "José", userId: jose.id } });

    mockSession("u-jose");
    const req = new Request("http://localhost/api/events/evt-1/payments/historical/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerName: "Pai", creditorName: "José" }),
    });
    const res = await POST({ params: { id: "evt-1" }, request: req } as any);
    expect(res.status).toBe(200);
  });

  it("rejects a player who tries to settle a debt they don't own and aren't admin for", async () => {
    mockCheckOwnership.mockResolvedValue({ isOwner: false, isAdmin: false, session: null } as any);

    // Setup: Pai owes José. A third user, Ana, is logged in.
    const pai = await prisma.user.create({ data: { id: "u-pai", name: "Pai", email: "p@t.com", emailVerified: true } });
    const jose = await prisma.user.create({ data: { id: "u-jose", name: "José", email: "j@t.com", emailVerified: true } });
    const ana = await prisma.user.create({ data: { id: "u-ana", name: "Ana", email: "a@t.com", emailVerified: true } });
    const event = await prisma.event.create({
      data: { id: "evt-1", title: "Game", dateTime: new Date(), maxPlayers: 10, location: "Field" },
    });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Pai", userId: pai.id } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "José", userId: jose.id } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Ana", userId: ana.id } });

    mockSession("u-ana");
    const req = new Request("http://localhost/api/events/evt-1/payments/historical/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerName: "Pai", creditorName: "José" }),
    });
    const res = await POST({ params: { id: "evt-1" }, request: req } as any);
    expect(res.status).toBe(403);
  });
});
