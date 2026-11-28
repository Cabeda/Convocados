import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET as getPostGameStatus } from "~/pages/api/events/[id]/post-game-status";
import { resetViewerNamesCache } from "~/lib/postgame.server";
import { getSession, checkOwnership } from "~/lib/auth.helpers.server";
import { resolvePaymentDetails } from "~/lib/paymentDetailsResolve.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn(),
}));
// The real resolver, watched: the poll must not reach it.
vi.mock("~/lib/paymentDetailsResolve.server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, any>>();
  return { ...actual, resolvePaymentDetails: vi.fn(actual.resolvePaymentDetails) };
});

const mockGetSession = vi.mocked(getSession);
const mockCheckOwnership = vi.mocked(checkOwnership);
const mockResolveDetails = vi.mocked(resolvePaymentDetails);

const get = async (id: string, poll = false) => {
  const url = `http://localhost/api/events/${id}/post-game-status${poll ? "?poll=1" : ""}`;
  const res = await getPostGameStatus({ request: new Request(url, { method: "GET" }), params: { id }, url: new URL(url) } as any);
  return res.json();
};

const kickoff = new Date(Date.now() - 3 * 3600_000);

/** A tracked, costed last game: Ana owes Maria, and Maria has a MB Way number to pay to. */
async function seedCostedGame() {
  const event = await prisma.event.create({
    data: { title: "Pay", location: "P", dateTime: kickoff, teamOneName: "Foxes", teamTwoName: "Lions" },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime: kickoff, status: "played", payerExternalName: "Maria" } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  const ana = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Ana", userId: "u-ana" } });
  await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: ana.id, order: 0 } });
  const payment = await prisma.gamePayment.create({ data: { gameId: game.id, eventPlayerId: ana.id, playerName: "Ana", amount: 5, status: "pending" } });
  await prisma.eventCost.create({ data: { eventId: event.id, totalAmount: 10, currency: "EUR", paymentMethods: JSON.stringify([{ type: "mbway", value: "911111111" }]) } });
  await prisma.gameHistory.create({
    data: {
      eventId: event.id, dateTime: kickoff, status: "played", scoreOne: 5, scoreTwo: 3, teamOneName: "Foxes", teamTwoName: "Lions",
      teamsSnapshot: JSON.stringify([{ team: "Foxes", players: [{ name: "Ana", order: 0 }] }, { team: "Lions", players: [{ name: "Rui", order: 0 }] }]),
    },
  });
  return { event, game, payment };
}

/** Calls that look a viewer's linked roster NAMES up (`select: { name }` for their `userId`); the MVP check reads the table for ids. */
const nameLookups = (spy: { mock: { calls: unknown[][] } }, userId = "u-ana") =>
  spy.mock.calls.filter((c) => {
    const arg = c[0] as { where?: { userId?: string }; select?: { name?: boolean } } | undefined;
    return arg?.where?.userId === userId && arg.select?.name === true;
  });

const signInAs = (id: string, name: string) => {
  mockGetSession.mockResolvedValue({ user: { id, name } } as any);
  mockCheckOwnership.mockResolvedValue(null as any);
};

beforeEach(async () => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  resetViewerNamesCache();
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  for (const m of ["mvpVote", "gamePayment", "gameParticipant", "game", "eventPlayer", "playerPayment", "eventCost", "gameHistory", "teamResult", "player", "event", "user"] as const) {
    await (prisma[m] as any).deleteMany();
  }
  await prisma.user.create({ data: { id: "u-ana", name: "anab99", email: "ana@example.com", emailVerified: true } });
});

describe("post-game-status poll: the static fields are computed once, not every 15 s", () => {
  it("the full read looks the viewer's roster names and the collector's payment details up", async () => {
    const { event } = await seedCostedGame();
    signInAs("u-ana", "anab99");
    const playerFind = vi.spyOn(prisma.player, "findMany");
    const eventPlayerFind = vi.spyOn(prisma.eventPlayer, "findMany");
    const json = await get(event.id);
    expect(nameLookups(playerFind)).toHaveLength(1);
    expect(nameLookups(eventPlayerFind)).toHaveLength(1);
    expect(mockResolveDetails).toHaveBeenCalledTimes(1);
    expect(json.viewerNames).toEqual(expect.arrayContaining(["anab99", "Ana"]));
    expect(json.payerHasPaymentDetails).toBe(true);
  });

  it("a poll after it runs neither name query nor the payment-details resolver", async () => {
    const { event } = await seedCostedGame();
    signInAs("u-ana", "anab99");
    await get(event.id); // the page load
    const playerFind = vi.spyOn(prisma.player, "findMany");
    const eventPlayerFind = vi.spyOn(prisma.eventPlayer, "findMany");
    mockResolveDetails.mockClear();

    await get(event.id, true);
    await get(event.id, true);

    expect(nameLookups(playerFind)).toHaveLength(0);
    expect(nameLookups(eventPlayerFind)).toHaveLength(0);
    expect(mockResolveDetails).not.toHaveBeenCalled();
  });

  it("leaves the static fields out of the poll and still answers every dynamic one for this viewer", async () => {
    const { event, payment } = await seedCostedGame();
    signInAs("u-ana", "anab99");
    await get(event.id);
    await prisma.gamePayment.update({ where: { id: payment.id }, data: { status: "sent" } });

    const poll = await get(event.id, true);

    expect(poll).not.toHaveProperty("viewerNames");
    expect(poll).not.toHaveProperty("payerHasPaymentDetails");
    // Viewer-scoped answers still come out right (they need the names, which the server remembered).
    expect(poll.isPlayer).toBe(true);
    expect(poll.viewerTeam).toBe(0);
    expect(poll.gamePayments).toEqual([expect.objectContaining({ name: "Ana", status: "sent" })]);
    expect(poll.scoreOne).toBe(5);
  });

  it("a poll that arrives with nothing remembered (restart, other machine) works the names out once, then remembers them", async () => {
    const { event } = await seedCostedGame();
    signInAs("u-ana", "anab99");
    const playerFind = vi.spyOn(prisma.player, "findMany");

    const first = await get(event.id, true);
    expect(first.isPlayer).toBe(true);
    expect(nameLookups(playerFind)).toHaveLength(1);
    expect(mockResolveDetails).not.toHaveBeenCalled();

    await get(event.id, true);
    expect(nameLookups(playerFind)).toHaveLength(1);
  });

  it("a full read refreshes what the polls know, so a newly linked player shows up", async () => {
    const { event } = await seedCostedGame();
    signInAs("u-ana", "anab99");
    expect((await get(event.id)).viewerNames).not.toContain("Zed");

    // The viewer is linked to another roster row; the polls do not look (the page load and actions do).
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Zed", userId: "u-ana" } });
    const playerFind = vi.spyOn(prisma.player, "findMany");
    await get(event.id, true);
    expect(nameLookups(playerFind)).toHaveLength(0);

    const full = await get(event.id);
    expect(full.viewerNames).toEqual(expect.arrayContaining(["Zed"]));
    expect(nameLookups(playerFind)).toHaveLength(1);
  });

  it("never serves one viewer's remembered names to another", async () => {
    const { event } = await seedCostedGame();
    signInAs("u-ana", "anab99");
    expect((await get(event.id)).isPlayer).toBe(true);
    await prisma.user.create({ data: { id: "u-other", name: "Other", email: "other@example.com", emailVerified: true } });
    signInAs("u-other", "Other");
    const poll = await get(event.id, true);
    expect(poll.isPlayer).toBe(false);
    expect(poll.viewerTeam).toBeNull();
  });

  it("a signed-out poll asks for no names at all", async () => {
    const { event } = await seedCostedGame();
    const playerFind = vi.spyOn(prisma.player, "findMany");
    const poll = await get(event.id, true);
    expect(nameLookups(playerFind)).toHaveLength(0);
    expect(poll.scoreOne).toBe(5);
  });
});
