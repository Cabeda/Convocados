import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { TOOLS } from "~/lib/mcp/tools";
import { findDiscoverableUpcomingEvents } from "~/lib/discoverableEvents.server";
import { GET } from "~/pages/api/me/games";
import { GET as getPublicEvents } from "~/pages/api/events/public";
import { GET as getUserProfile } from "~/pages/api/users/[id]";
import { getSession } from "~/lib/auth.helpers.server";
import { authenticateRequest } from "~/lib/authenticate.server";

vi.mock("~/lib/auth.helpers.server", () => ({ getSession: vi.fn() }));
vi.mock("~/lib/authenticate.server", () => ({ authenticateRequest: vi.fn() }));

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
  await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: eventPlayer.id, order, status } });
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
      isPublic: true,
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

function ctx(path: string, params: Record<string, string> = {}) {
  const url = new URL(`http://localhost${path}`);
  return { request: new Request(url, { method: "GET" }), params, url } as any;
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

    const fromGetGame = (await getGame!.handler({ eventId: event.id }, authCtx)) as any;
    const listedGame = ((await listMyGames!.handler({}, authCtx)) as any).owned.find(
      (g: any) => g.id === event.id,
    );
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const res = await GET(ctx("/api/me/games"));
    expect(res.status).toBe(200);
    const routeGame = (await res.json()).owned.find((g: any) => g.id === event.id);

    for (const row of [fromGetGame, listedGame, routeGame]) {
      expect([row.playerCount, row.spotsLeft]).toEqual([8, 2]);
    }
  });

  it("agrees on the same roster on Discover and GET /api/events/public", async () => {
    const { event } = await seedFixture();
    const discovered = (await findDiscoverableUpcomingEvents({ now: new Date(), take: 10 })).find(
      (g) => g.id === event.id,
    );
    const listed = (await (await getPublicEvents(ctx("/api/events/public"))).json()).data.find(
      (g: { id: string }) => g.id === event.id,
    );
    for (const row of [discovered, listed]) {
      expect([row!.playerCount, row!.spotsLeft]).toEqual([8, 2]);
    }
  });
  it("reports the current Game's roster on GET /api/users/[id]", async () => {
    const { user, event } = await seedFixture();
    mockGetSession.mockResolvedValue(null);
    const res = await getUserProfile(ctx(`/api/users/${user.id}`, { id: user.id }));
    expect(res.status).toBe(200);
    const owned = (await res.json()).owned.find((g: { id: string }) => g.id === event.id);
    expect(owned.playerCount).toBe(8);
  });

  it("agrees on active legacy Player rows when the Event has no current Game", async () => {
    const user = await prisma.user.create({
      data: { id: "legacy", name: "Organizer", email: "legacy@test.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: {
        title: "Legacy",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86_400_000),
        maxPlayers: 10,
        isPublic: true,
        ownerId: user.id,
      },
    });
    await prisma.player.createMany({
      data: [
        { eventId: event.id, name: "Active", order: 0 },
        { eventId: event.id, name: "Archived", order: 1, archivedAt: new Date() },
      ],
    });
    const authCtx = { userId: user.id, scopes: ["read:events"], authMethod: "oauth" as const };
    const getGame = TOOLS.find((t) => t.name === "convocados_get_game")!;
    const listMyGames = TOOLS.find((t) => t.name === "convocados_list_my_games")!;
    const fromGetGame = (await getGame.handler({ eventId: event.id }, authCtx)) as any;
    const listedGame = ((await listMyGames.handler({}, authCtx)) as any).owned.find(
      (g: any) => g.id === event.id,
    );
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const routeGame = (await (await GET(ctx("/api/me/games"))).json()).owned.find(
      (g: any) => g.id === event.id,
    );
    const profiled = (await (await getUserProfile(ctx(`/api/users/${user.id}`, { id: user.id }))).json()).owned.find(
      (g: any) => g.id === event.id,
    );
    const discovered = (await findDiscoverableUpcomingEvents({ now: new Date(), take: 10 })).find(
      (g) => g.id === event.id,
    );
    const listedPublic = (await (await getPublicEvents(ctx("/api/events/public"))).json()).data.find(
      (g: { id: string }) => g.id === event.id,
    );
    for (const row of [fromGetGame, listedGame, routeGame, discovered, listedPublic]) {
      expect([row!.playerCount, row!.spotsLeft]).toEqual([1, 9]);
    }
    expect(profiled.playerCount).toBe(1);
  });
});
