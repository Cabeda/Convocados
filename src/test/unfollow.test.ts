import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/me/follows";
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
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function ctx(body: unknown) {
  return {
    request: new Request("http://localhost/api/me/follows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
  } as any;
}

async function seedUser(id = "unfollow-user") {
  return prisma.user.create({
    data: { id, name: "Unfollow User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent() {
  return prisma.event.create({
    data: {
      title: "Test Game",
      location: "Pitch",
      dateTime: new Date(),
      maxPlayers: 10,
    },
  });
}

describe("POST /api/me/follows", () => {
  it("returns 401 when not authenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue(null);
    const res = await POST(ctx({ eventId: "abc" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 when eventId is missing", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const res = await POST(ctx({}));
    expect(res.status).toBe(400);
  });

  it("deletes the follow and returns ok", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const event = await seedEvent();
    await prisma.eventFollow.create({ data: { userId: user.id, eventId: event.id } });

    const res = await POST(ctx({ eventId: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    const follow = await prisma.eventFollow.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: user.id } },
    });
    expect(follow).toBeNull();
  });

  it("succeeds even if follow does not exist", async () => {
    const user = await seedUser();
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);
    const res = await POST(ctx({ eventId: "nonexistent" }));
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
