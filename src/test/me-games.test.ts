import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { GET } from "~/pages/api/me/games";
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

beforeEach(async () => {
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx(query = "") {
  return {
    request: new Request(`http://localhost/api/me/games${query}`, { method: "GET" }),
    params: {},
    url: new URL(`http://localhost/api/me/games${query}`),
  } as any;
}

async function seedUser(id = "user-games-1") {
  return prisma.user.create({
    data: { id, name: "Games User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent(ownerId?: string, overrides: Partial<{ title: string; archivedAt: Date }> = {}) {
  return prisma.event.create({
    data: {
      title: overrides.title ?? "Game",
      location: "Pitch",
      dateTime: new Date(),
      maxPlayers: 10,
      ownerId: ownerId ?? null,
      archivedAt: overrides.archivedAt ?? null,
    },
  });
}

describe("GET /api/me/games", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue(null);
    const res = await GET(ctx());
    expect(res.status).toBe(401);
  });

  it("uses OAuth auth context when available", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue({ userId: user.id, client: {} as any });
    mockGetSession.mockResolvedValue(null);
    await seedEvent(user.id);
    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owned).toHaveLength(1);
  });

  it("uses session cookie when OAuth is not available", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    await seedEvent(user.id);
    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owned).toHaveLength(1);
  });

  it("paginates owned games with cursor", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    // Use distinct dateTimes so cursor ordering is deterministic
    const event1 = await seedEvent(user.id, { title: "Game 1" });
    const event2 = await seedEvent(user.id, { title: "Game 2" });
    const event3 = await seedEvent(user.id, { title: "Game 3" });

    // First page without cursor returns all 3
    const resAll = await GET(ctx(`?limit=10`));
    const bodyAll = await resAll.json();
    expect(bodyAll.owned).toHaveLength(3);

    // With a cursor, we get fewer results
    const res = await GET(ctx(`?limit=10&ownedCursor=${event2.id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owned.length).toBeLessThan(3);
    expect(body.ownedHasMore).toBe(false);
  });

  it("paginates joined games with cursor", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const event1 = await seedEvent(undefined, { title: "Game 1" });
    const event2 = await seedEvent(undefined, { title: "Game 2" });
    const event3 = await seedEvent(undefined, { title: "Game 3" });
    const player1 = await prisma.player.create({ data: { name: user.name, eventId: event1.id, userId: user.id } });
    const player2 = await prisma.player.create({ data: { name: user.name, eventId: event2.id, userId: user.id } });
    const player3 = await prisma.player.create({ data: { name: user.name, eventId: event3.id, userId: user.id } });

    // First page without cursor returns all 3
    const resAll = await GET(ctx(`?limit=10`));
    const bodyAll = await resAll.json();
    expect(bodyAll.joined).toHaveLength(3);

    // With a cursor, we get fewer results (cursor skips the cursor record)
    const res = await GET(ctx(`?limit=10&joinedCursor=${player2.id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    // After cursor, we get fewer than the full 3
    expect(body.joined.length).toBeLessThan(3);
    expect(body.joinedHasMore).toBe(false);
  });

  it("returns hasMore=true when more owned games exist", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    await seedEvent(user.id, { title: "Game 1" });
    await seedEvent(user.id, { title: "Game 2" });
    await seedEvent(user.id, { title: "Game 3" });

    const res = await GET(ctx("?limit=2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owned).toHaveLength(2);
    expect(body.ownedHasMore).toBe(true);
    expect(body.ownedNextCursor).toBeTruthy();
  });

  it("returns hasMore=true when more joined games exist", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const event1 = await seedEvent(undefined, { title: "Game 1" });
    const event2 = await seedEvent(undefined, { title: "Game 2" });
    const event3 = await seedEvent(undefined, { title: "Game 3" });
    await prisma.player.create({ data: { name: user.name, eventId: event1.id, userId: user.id } });
    await prisma.player.create({ data: { name: user.name, eventId: event2.id, userId: user.id } });
    await prisma.player.create({ data: { name: user.name, eventId: event3.id, userId: user.id } });

    const res = await GET(ctx("?limit=2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.joined).toHaveLength(2);
    expect(body.joinedHasMore).toBe(true);
    expect(body.joinedNextCursor).toBeTruthy();
  });
});
