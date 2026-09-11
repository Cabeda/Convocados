/**
 * History / game-detail payments must read the durable per-game settlement
 * (GamePayment) instead of the stale legacy GameHistory.paymentsSnapshot.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: false, session: null }),
  checkEventAdmin: vi.fn().mockResolvedValue(false),
}));

import { GET as getHistoryEntry } from "~/pages/api/events/[id]/history/[historyId]";
import { syncGamePayments, setPaymentConfig } from "~/lib/settlement.server";

function ctx(params: Record<string, string>) {
  return { request: new Request("http://localhost/api/test"), params } as any;
}

async function seedEventWithGame(opts: {
  cost?: number;
  players?: string[];
  mode?: "tracked" | "untracked";
  withPayer?: boolean;
} = {}) {
  const cost = opts.cost ?? 60;
  const event = await prisma.event.create({
    data: {
      title: "History Settlement Event",
      location: "Pitch",
      dateTime: new Date("2026-09-07T18:00:00Z"),
      maxPlayers: 10,
      showCompetitiveData: true,
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "played", teamOneName: "Ninjas", teamTwoName: "Gunas" },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

  const names = opts.players ?? ["Ana", "Bruno", "Carla"];
  for (let i = 0; i < names.length; i++) {
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: names[i] } });
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: ep.id, order: i } });
  }
  const teamA = await prisma.teamResult.create({ data: { eventId: event.id, name: "Ninjas" } });
  const teamB = await prisma.teamResult.create({ data: { eventId: event.id, name: "Gunas" } });
  await prisma.teamMember.create({
    data: { teamResultId: teamA.id, name: names[0], order: 0 },
  });
  await prisma.teamMember.create({
    data: { teamResultId: teamB.id, name: names[1] ?? names[0], order: 0 },
  });
  await prisma.eventCost.create({
    data: { eventId: event.id, totalAmount: cost, currency: "EUR" },
  });
  await syncGamePayments(game.id, event.id);

  if (opts.mode === "untracked") {
    await setPaymentConfig(event.id, game.id, { mode: "untracked" });
  } else if (opts.withPayer) {
    const ana = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name: "Ana" } });
    await setPaymentConfig(event.id, game.id, { mode: "tracked", payerEventPlayerId: ana.id });
  }

  return { event, game };
}

beforeEach(async () => {
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.gamePayment.deleteMany();
  await prisma.walletTransaction.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.player.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("GET /api/events/[id]/history/[historyId] — game settlement", () => {
  it("returns GamePayment statuses, ignoring the stale GameHistory snapshot", async () => {
    const { event, game } = await seedEventWithGame({ withPayer: true });
    // Stale legacy snapshot says only Carla paid; the real rows say Ana (payer) paid.
    const gh = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: game.dateTime,
        status: "played",
        teamOneName: "Ninjas",
        teamTwoName: "Gunas",
        source: "live",
        paymentsSnapshot: JSON.stringify([{ playerName: "Carla", amount: 6, status: "paid" }]),
      },
    });

    const res = await getHistoryEntry(ctx({ id: event.id, historyId: gh.id }));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.paymentConfig?.gameId).toBe(game.id);
    const byName = new Map<string, { status: string; amount: number }>(
      (JSON.parse(body.paymentsSnapshot) as Array<{ playerName: string; status: string; amount: number }>)
        .map((p) => [p.playerName, { status: p.status, amount: p.amount }]),
    );
    expect(byName.get("Ana")?.status).toBe("paid"); // auto-settled payer
    expect(byName.get("Bruno")?.status).toBe("pending");
    expect(byName.get("Carla")?.status).toBe("pending");
    // The stale snapshot must be gone.
    expect(byName.has("Carla") && byName.get("Carla")?.status).not.toBe("paid");
  });

  it("returns the settlement config when addressed by Game id (not GameHistory)", async () => {
    const { event, game } = await seedEventWithGame();
    const res = await getHistoryEntry(ctx({ id: event.id, historyId: game.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paymentConfig?.gameId).toBe(game.id);
    // teamsSnapshot must be a parseable array, not a double-encoded string.
    const teams = JSON.parse(body.teamsSnapshot);
    expect(Array.isArray(teams)).toBe(true);
  });

  it("keeps the legacy snapshot for a historical entry with no Game", async () => {
    const event = await prisma.event.create({
      data: { title: "Backfill", location: "Pitch", dateTime: new Date("2025-01-01T18:00:00Z"), showCompetitiveData: true },
    });
    const gh = await prisma.gameHistory.create({
      data: {
        eventId: event.id,
        dateTime: event.dateTime,
        status: "played",
        teamOneName: "A",
        teamTwoName: "B",
        source: "historical",
        paymentsSnapshot: JSON.stringify([{ playerName: "Legacy", amount: 5, status: "paid" }]),
      },
    });

    const res = await getHistoryEntry(ctx({ id: event.id, historyId: gh.id }));
    const body = await res.json();
    expect(body.paymentConfig).toBeNull();
    expect(JSON.parse(body.paymentsSnapshot)).toEqual([{ playerName: "Legacy", amount: 5, status: "paid" }]);
  });

  it("returns a null snapshot for untracked games", async () => {
    const { event, game } = await seedEventWithGame({ mode: "untracked" });
    const res = await getHistoryEntry(ctx({ id: event.id, historyId: game.id }));
    const body = await res.json();
    expect(body.paymentConfig?.mode).toBe("untracked");
    expect(body.paymentsSnapshot).toBeNull();
  });
});
