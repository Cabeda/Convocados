import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/me/co-players";
import { getSession } from "~/lib/auth.helpers.server";
import { authenticateRequest } from "~/lib/authenticate.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);
const mockAuthenticateRequest = vi.mocked(authenticateRequest);

const DAY_MS = 86_400_000;

beforeEach(async () => {
  await prisma.playerInvite.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.priorityEnrollment.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
});

function ctx() {
  return {
    request: new Request("http://localhost/api/me/co-players", { method: "GET" }),
    params: {},
    url: new URL("http://localhost/api/me/co-players"),
  } as any;
}

function mockAuth(userId: string) {
  mockAuthenticateRequest.mockResolvedValue({ userId, scopes: ["*"], authMethod: "oauth" });
}

async function seedUser(id: string, name = "User") {
  return prisma.user.create({
    data: { id, name, email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(id: string, daysFromNow: number) {
  return prisma.event.create({
    data: {
      id,
      title: `Game ${id}`,
      location: "Pitch",
      dateTime: new Date(Date.now() + daysFromNow * DAY_MS),
      maxPlayers: 10,
    },
  });
}

async function seedEventPlayer(eventId: string, userId: string | null, name: string, gamesPlayed = 0) {
  return prisma.eventPlayer.create({
    data: { eventId, userId, name, gamesPlayed },
  });
}

async function seedGame(eventId: string, daysAgo: number, participantEpIds: string[]) {
  return prisma.game.create({
    data: {
      eventId,
      dateTime: new Date(Date.now() - daysAgo * DAY_MS),
      status: "played",
      participants: {
        create: participantEpIds.map((eventPlayerId) => ({
          eventPlayerId,
          status: "active",
        })),
      },
    },
  });
}

describe("GET /api/me/co-players", () => {
  it("returns 401 when unauthenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue(null);

    const res = await GET(ctx());
    expect(res.status).toBe(401);
  });

  it("aggregates co-players across multiple events sorted by co-play count", async () => {
    await seedUser("me");
    await seedUser("alice", "Alice");
    await seedUser("bob", "Bob");

    // Event A (10 days ago): me + alice + bob
    await seedEvent("ev-a", -10);
    const meA = await seedEventPlayer("ev-a", "me", "Me");
    const aliceA = await seedEventPlayer("ev-a", "alice", "Alice");
    const bobA = await seedEventPlayer("ev-a", "bob", "Bob");
    await seedGame("ev-a", 10, [meA.id, aliceA.id, bobA.id]);

    // Event B (5 days ago): me + alice again
    await seedEvent("ev-b", -5);
    const meB = await seedEventPlayer("ev-b", "me", "Me");
    const aliceB = await seedEventPlayer("ev-b", "alice", "Alice");
    await seedGame("ev-b", 5, [meB.id, aliceB.id]);

    mockAuth("me");

    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();

    const alice = body.players.find((p: { userId: string }) => p.userId === "alice");
    const bob = body.players.find((p: { userId: string }) => p.userId === "bob");
    expect(alice).toBeDefined();
    expect(alice.coPlayCount).toBe(2);
    expect(alice.name).toBe("Alice");
    expect(bob).toBeDefined();
    expect(bob.coPlayCount).toBe(1);

    // Sorted by coPlayCount desc
    expect(body.players[0].userId).toBe("alice");
  });

  it("never includes the caller themself", async () => {
    await seedUser("me");
    await seedEvent("ev-x", -3);
    const meEp = await seedEventPlayer("ev-x", "me", "Me");
    await seedGame("ev-x", 3, [meEp.id]);

    mockAuth("me");

    const res = await GET(ctx());
    const body = await res.json();
    expect(body.players).toHaveLength(0);
  });

  it("excludes co-plays older than the 365-day window", async () => {
    await seedUser("me");
    await seedUser("old-friend", "Old Friend");

    await seedEvent("ev-old", -400);
    const meEp = await seedEventPlayer("ev-old", "me", "Me");
    const oldEp = await seedEventPlayer("ev-old", "old-friend", "Old Friend");
    await seedGame("ev-old", 400, [meEp.id, oldEp.id]);

    mockAuth("me");

    const res = await GET(ctx());
    const body = await res.json();
    expect(body.players).toHaveLength(0);
  });

  it("resolves profile image for account-linked co-players", async () => {
    await seedUser("me");
    await prisma.user.create({
      data: { id: "img-user", name: "Imaged", email: "img-user@test.com", emailVerified: true, image: "https://example.com/a.png" },
    });

    await seedEvent("ev-img", -1);
    const meEp = await seedEventPlayer("ev-img", "me", "Me");
    const imgEp = await seedEventPlayer("ev-img", "img-user", "Imaged");
    await seedGame("ev-img", 1, [meEp.id, imgEp.id]);

    mockAuth("me");

    const res = await GET(ctx());
    const body = await res.json();
    expect(body.players).toHaveLength(1);
    expect(body.players[0].image).toBe("https://example.com/a.png");
  });

  it("includes name-only guests grouped by name with null userId", async () => {
    await seedUser("me");
    await seedEvent("ev-guest", -2);
    const meEp = await seedEventPlayer("ev-guest", "me", "Me");
    // Two guests (no userId) with the same name across two games.
    const guestA1 = await seedEventPlayer("ev-guest", null, "Luís Lopes");
    await seedGame("ev-guest", 2, [meEp.id, guestA1.id]);
    await seedEvent("ev-guest-2", -4);
    const meEp2 = await seedEventPlayer("ev-guest-2", "me", "Me");
    const guestA2 = await seedEventPlayer("ev-guest-2", null, "luís lopes");
    await seedGame("ev-guest-2", 4, [meEp2.id, guestA2.id]);

    mockAuth("me");

    const res = await GET(ctx());
    const body = await res.json();
    const luis = body.players.find((p: { name: string }) => p.name.toLowerCase() === "luís lopes");
    expect(luis).toBeDefined();
    expect(luis.userId).toBeNull();
    // Two games → co-play count 2 (case-insensitive grouping)
    expect(luis.coPlayCount).toBe(2);
    expect(luis.name).toBe("Luís Lopes");
  });

  it("caps results at 30", async () => {
    await seedUser("me");
    await seedEvent("ev-many", -2);
    const meEp = await seedEventPlayer("ev-many", "me", "Me");
    const epIds = [meEp.id];
    for (let i = 0; i < 35; i++) {
      const u = await seedUser(`u-${i}`, `Player ${i}`);
      epIds.push((await seedEventPlayer("ev-many", u.id, `Player ${i}`)).id);
    }
    await seedGame("ev-many", 2, epIds);

    mockAuth("me");

    const res = await GET(ctx());
    const body = await res.json();
    expect(body.players.length).toBeLessThanOrEqual(30);
  });
});
