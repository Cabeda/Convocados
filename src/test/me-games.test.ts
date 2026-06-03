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
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventAdmin.deleteMany();
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
    mockAuthenticateRequest.mockResolvedValue({ userId: user.id, clientId: "test", scopes: ["*"], authMethod: "oauth" as const });
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
    const _event1 = await seedEvent(user.id, { title: "Game 1" });
    const event2 = await seedEvent(user.id, { title: "Game 2" });
    const _event3 = await seedEvent(user.id, { title: "Game 3" });

    const resAll = await GET(ctx(`?limit=10`));
    const bodyAll = await resAll.json();
    expect(bodyAll.owned).toHaveLength(3);

    const res = await GET(ctx(`?limit=10&ownedCursor=${event2.id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.owned.length).toBeLessThan(3);
    expect(body.ownedHasMore).toBe(false);
  });

  it("paginates followed games with cursor", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const event1 = await seedEvent(undefined, { title: "Game 1" });
    const event2 = await seedEvent(undefined, { title: "Game 2" });
    const event3 = await seedEvent(undefined, { title: "Game 3" });
    await prisma.eventFollow.create({ data: { userId: user.id, eventId: event1.id } });
    const follow2 = await prisma.eventFollow.create({ data: { userId: user.id, eventId: event2.id } });
    await prisma.eventFollow.create({ data: { userId: user.id, eventId: event3.id } });

    const resAll = await GET(ctx(`?limit=10`));
    const bodyAll = await resAll.json();
    expect(bodyAll.followed).toHaveLength(3);

    const res = await GET(ctx(`?limit=10&followedCursor=${follow2.id}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.followed.length).toBeLessThan(3);
    expect(body.followedHasMore).toBe(false);
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

  it("returns hasMore=true when more followed games exist", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const event1 = await seedEvent(undefined, { title: "Game 1" });
    const event2 = await seedEvent(undefined, { title: "Game 2" });
    const event3 = await seedEvent(undefined, { title: "Game 3" });
    await prisma.eventFollow.create({ data: { userId: user.id, eventId: event1.id } });
    await prisma.eventFollow.create({ data: { userId: user.id, eventId: event2.id } });
    await prisma.eventFollow.create({ data: { userId: user.id, eventId: event3.id } });

    const res = await GET(ctx("?limit=2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.followed).toHaveLength(2);
    expect(body.followedHasMore).toBe(true);
    expect(body.followedNextCursor).toBeTruthy();
  });

  it("includes admin events in admin section", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const event = await seedEvent(undefined, { title: "Admin Game" });
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: user.id } });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.admin).toHaveLength(1);
    expect(body.admin[0].title).toBe("Admin Game");
  });

  it("deduplicates admin events that are also owned", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const event = await seedEvent(user.id, { title: "Owned + Admin" });
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: user.id } });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.owned).toHaveLength(1);
    expect(body.admin).toHaveLength(0);
    expect(body.followed).toHaveLength(0);
  });

  it("deduplicates followed events that are also owned or admin", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const ownedEvent = await seedEvent(user.id, { title: "Owned" });
    const adminEvent = await seedEvent(undefined, { title: "Admin" });
    const followEvent = await seedEvent(undefined, { title: "Followed" });
    await prisma.eventAdmin.create({ data: { eventId: adminEvent.id, userId: user.id } });
    await prisma.eventFollow.create({ data: { userId: user.id, eventId: ownedEvent.id } });
    await prisma.eventFollow.create({ data: { userId: user.id, eventId: adminEvent.id } });
    await prisma.eventFollow.create({ data: { userId: user.id, eventId: followEvent.id } });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.owned).toHaveLength(1);
    expect(body.admin).toHaveLength(1);
    expect(body.admin[0].title).toBe("Admin");
    expect(body.followed).toHaveLength(1);
    expect(body.followed[0].title).toBe("Followed");
  });

  it("does not include archived events in admin section", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const event = await seedEvent(undefined, { title: "Archived Admin", archivedAt: new Date() });
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: user.id } });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.admin).toHaveLength(0);
  });

  it("does not include archived events in followed section", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const event = await seedEvent(undefined, { title: "Archived Followed", archivedAt: new Date() });
    await prisma.eventFollow.create({ data: { userId: user.id, eventId: event.id } });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.followed).toHaveLength(0);
  });

  it("does not return archivedJoined or archivedFollowed", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const res = await GET(ctx());
    const body = await res.json();
    expect(body).not.toHaveProperty("archivedJoined");
    expect(body).not.toHaveProperty("archivedFollowed");
  });

  it("returns archived admin events", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const event = await seedEvent(undefined, { title: "Archived Admin", archivedAt: new Date() });
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: user.id } });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.archivedAdmin).toHaveLength(1);
    expect(body.archivedAdmin[0].title).toBe("Archived Admin");
    expect(body.admin).toHaveLength(0);
  });

  it("includes non-archived admin in admin, archived in archivedAdmin", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const active = await seedEvent(undefined, { title: "Active Admin" });
    const archived = await seedEvent(undefined, { title: "Archived Admin", archivedAt: new Date() });
    await prisma.eventAdmin.create({ data: { eventId: active.id, userId: user.id } });
    await prisma.eventAdmin.create({ data: { eventId: archived.id, userId: user.id } });
    const res = await GET(ctx());
    const body = await res.json();
    expect(body.admin).toHaveLength(1);
    expect(body.admin[0].title).toBe("Active Admin");
    expect(body.archivedAdmin).toHaveLength(1);
    expect(body.archivedAdmin[0].title).toBe("Archived Admin");
  });
});
