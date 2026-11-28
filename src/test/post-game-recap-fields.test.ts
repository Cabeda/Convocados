import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET as getPostGameStatus } from "~/pages/api/events/[id]/post-game-status";
import { getSession, checkOwnership } from "~/lib/auth.helpers.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);
const mockCheckOwnership = vi.mocked(checkOwnership);

function ctx(params: Record<string, string>) {
  const url = "http://localhost/api/test";
  return { request: new Request(url, { method: "GET" }), params, url: new URL(url) } as any;
}

const kickoff = new Date(Date.now() - 3 * 3600_000);

async function seedLastGame(opts: { status?: string; scored?: boolean } = {}) {
  const event = await prisma.event.create({
    data: { title: "Recap", location: "Pitch", dateTime: new Date(Date.now() + 5 * 86_400_000), isRecurring: true, teamOneName: "Foxes", teamTwoName: "Lions" },
  });
  await prisma.gameHistory.create({
    data: {
      eventId: event.id, dateTime: kickoff, status: opts.status ?? "played",
      scoreOne: opts.scored === false ? null : 5, scoreTwo: opts.scored === false ? null : 3,
      teamOneName: "Foxes", teamTwoName: "Lions",
      teamsSnapshot: JSON.stringify([
        { team: "Foxes", players: [{ name: "Ana", order: 0 }] },
        { team: "Lions", players: [{ name: "Rui", order: 0 }] },
      ]),
    },
  });
  return event;
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  for (const m of ["mvpVote", "gamePayment", "gameParticipant", "game", "eventPlayer", "playerPayment", "eventCost", "gameHistory", "teamResult", "player", "event", "user"] as const) {
    await (prisma[m] as any).deleteMany();
  }
});

describe("post-game-status: recap fields", () => {
  it("reports which team the viewer played for", async () => {
    const event = await seedLastGame();
    mockGetSession.mockResolvedValue({ user: { id: "u-rui", name: "Rui" } } as any);
    mockCheckOwnership.mockResolvedValue(null as any);
    const json = await (await getPostGameStatus(ctx({ id: event.id }))).json();
    expect(json.viewerTeam).toBe(1);
  });

  it("matches the viewer's name case-insensitively", async () => {
    const event = await seedLastGame();
    mockGetSession.mockResolvedValue({ user: { id: "u-ana", name: " ANA " } } as any);
    mockCheckOwnership.mockResolvedValue(null as any);
    expect((await (await getPostGameStatus(ctx({ id: event.id }))).json()).viewerTeam).toBe(0);
  });

  it("has no viewerTeam for someone who did not play", async () => {
    const event = await seedLastGame();
    mockGetSession.mockResolvedValue({ user: { id: "u-zed", name: "Zed" } } as any);
    mockCheckOwnership.mockResolvedValue(null as any);
    expect((await (await getPostGameStatus(ctx({ id: event.id }))).json()).viewerTeam).toBeNull();
  });

  it("has no viewerTeam for a signed-out viewer, but still reports the result", async () => {
    const event = await seedLastGame();
    const json = await (await getPostGameStatus(ctx({ id: event.id }))).json();
    expect(json.viewerTeam).toBeNull();
    expect(json.scoreOne).toBe(5);
    expect(json.scoreTwo).toBe(3);
  });

  it("reports when the last game was played", async () => {
    const event = await seedLastGame();
    const json = await (await getPostGameStatus(ctx({ id: event.id }))).json();
    expect(json.lastGameDateTime).toBe(kickoff.toISOString());
  });

  it("has no last game when the event has not been played yet", async () => {
    const event = await prisma.event.create({ data: { title: "New", location: "P", dateTime: new Date(Date.now() + 86_400_000) } });
    const json = await (await getPostGameStatus(ctx({ id: event.id }))).json();
    expect(json.lastGameDateTime).toBeNull();
    expect(json.viewerTeam).toBeNull();
  });

  it("keeps the cancelled payload neutral (no last game, no viewerTeam)", async () => {
    const event = await seedLastGame({ status: "cancelled" });
    const json = await (await getPostGameStatus(ctx({ id: event.id }))).json();
    expect(json.lastGameDateTime).toBeNull();
    expect(json.viewerTeam).toBeNull();
  });

  it("treats an ended one-off with no history row as a last game (kickoff = event date)", async () => {
    const ended = new Date(Date.now() - 3 * 3600_000);
    const event = await prisma.event.create({ data: { title: "One-off", location: "P", dateTime: ended } });
    const json = await (await getPostGameStatus(ctx({ id: event.id }))).json();
    expect(json.lastGameDateTime).toBe(ended.toISOString());
    expect(json.hasScore).toBe(false);
    expect(json.latestHistoryId).toBeNull();
  });

  it("matches the viewer through their linked player when the account name differs", async () => {
    const event = await seedLastGame();
    await prisma.user.create({ data: { id: "u-link", name: "anab99", email: "anab@example.com", emailVerified: true } });
    await prisma.player.create({ data: { eventId: event.id, name: "Rui", userId: "u-link" } });
    mockGetSession.mockResolvedValue({ user: { id: "u-link", name: "anab99" } } as any);
    mockCheckOwnership.mockResolvedValue(null as any);
    const json = await (await getPostGameStatus(ctx({ id: event.id }))).json();
    expect(json.isPlayer).toBe(true);
    expect(json.viewerTeam).toBe(1);
    expect(json.viewerNames).toEqual(expect.arrayContaining(["anab99", "Rui"]));
  });

  it("includes the linked roster name of the payment rows in viewerNames", async () => {
    const event = await seedLastGame();
    await prisma.user.create({ data: { id: "u-ep", name: "Account", email: "acc@example.com", emailVerified: true } });
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Ana", userId: "u-ep" } });
    mockGetSession.mockResolvedValue({ user: { id: "u-ep", name: "Account" } } as any);
    mockCheckOwnership.mockResolvedValue(null as any);
    const json = await (await getPostGameStatus(ctx({ id: event.id }))).json();
    expect(json.viewerNames).toEqual(expect.arrayContaining(["Account", "Ana"]));
    expect(json.viewerTeam).toBe(0);
  });

  it("has no viewerNames for a signed-out viewer", async () => {
    const event = await seedLastGame();
    expect((await (await getPostGameStatus(ctx({ id: event.id }))).json()).viewerNames).toEqual([]);
  });

  it("reports whether the collector has payment details to show", async () => {
    const event = await prisma.event.create({
      data: { title: "Pay", location: "P", dateTime: kickoff, teamOneName: "Foxes", teamTwoName: "Lions" },
    });
    const game = await prisma.game.create({
      data: { eventId: event.id, dateTime: kickoff, status: "played", payerExternalName: "Maria" },
    });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
    const ana = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Ana" } });
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: ana.id, order: 0 } });
    await prisma.gamePayment.create({ data: { gameId: game.id, eventPlayerId: ana.id, playerName: "Ana", amount: 5, status: "pending" } });
    const cost = await prisma.eventCost.create({ data: { eventId: event.id, totalAmount: 10, currency: "EUR" } });

    expect((await (await getPostGameStatus(ctx({ id: event.id }))).json()).payerHasPaymentDetails).toBe(false);

    await prisma.eventCost.update({ where: { id: cost.id }, data: { paymentMethods: JSON.stringify([{ type: "mbway", value: "911111111" }]) } });
    expect((await (await getPostGameStatus(ctx({ id: event.id }))).json()).payerHasPaymentDetails).toBe(true);
  });

  it("counts how many people played the last game", async () => {
    const event = await seedLastGame();
    expect((await (await getPostGameStatus(ctx({ id: event.id }))).json()).lastGamePlayerCount).toBe(2);
  });
});
