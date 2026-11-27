import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { TOOLS } from "~/lib/mcp/tools";
import { GET } from "~/pages/api/me/games";
import { getSession } from "~/lib/auth.helpers.server";
import { authenticateRequest } from "~/lib/authenticate.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);
const mockAuthenticateRequest = vi.mocked(authenticateRequest);

async function addParticipant(
  eventId: string,
  gameId: string,
  name: string,
  order: number,
  status: "active" | "pending",
) {
  const eventPlayer = await prisma.eventPlayer.create({ data: { eventId, name } });
  await prisma.gameParticipant.create({
    data: { gameId, eventPlayerId: eventPlayer.id, order, status },
  });
}

async function seedFixture() {
  const user = await prisma.user.create({
    data: { id: "roster-surfaces-user", name: "Organizer", email: "organizer@test.com", emailVerified: true },
  });
  const event = await prisma.event.create({
    data: {
      title: "Friday Futsal",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
      maxPlayers: 10,
      isRecurring: true,
      recurrenceRule: "FREQ=WEEKLY",
      ownerId: user.id,
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

  for (let i = 0; i < 8; i++) {
    await addParticipant(event.id, game.id, `Active ${i + 1}`, i, "active");
  }
  for (let i = 0; i < 2; i++) {
    await addParticipant(event.id, game.id, `Invited ${i + 1}`, 8 + i, "pending");
  }

  return { user, event };
}

function requestCtx() {
  const url = new URL("http://localhost/api/me/games");
  return {
    request: new Request(url, { method: "GET" }),
    params: {},
    url,
  } as any;
}

beforeEach(async () => {
  await prisma.gameParticipant.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  vi.clearAllMocks();
});

describe("roster count surfaces", () => {
  it("agrees on playerCount and spotsLeft for get_game, list_my_games and GET /api/me/games", async () => {
    const { user, event } = await seedFixture();
    const authCtx = { userId: user.id, scopes: ["read:events"], authMethod: "oauth" as const };

    const getGame = TOOLS.find((t) => t.name === "convocados_get_game");
    const listMyGames = TOOLS.find((t) => t.name === "convocados_list_my_games");
    expect(getGame).toBeDefined();
    expect(listMyGames).toBeDefined();

    const fromGetGame = (await getGame!.handler({ eventId: event.id }, authCtx)) as any;
    const fromListMyGames = (await listMyGames!.handler({}, authCtx)) as any;
    const listedGame = fromListMyGames.owned.find((g: any) => g.id === event.id);

    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const res = await GET(requestCtx());
    expect(res.status).toBe(200);
    const fromRoute = await res.json();
    const routeGame = fromRoute.owned.find((g: any) => g.id === event.id);

    expect(fromGetGame.playerCount).toBe(8);
    expect(fromGetGame.spotsLeft).toBe(2);
    expect(listedGame.playerCount).toBe(8);
    expect(listedGame.spotsLeft).toBe(2);
    expect(routeGame.playerCount).toBe(8);
    expect(routeGame.spotsLeft).toBe(2);
  });
});
