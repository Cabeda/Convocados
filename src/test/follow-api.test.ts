import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { DELETE } from "~/pages/api/events/[id]/follow";
import { getSession } from "~/lib/auth.helpers.server";
import { authenticateRequest } from "~/lib/authenticate.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);
const mockAuthenticateRequest = vi.mocked(authenticateRequest);

function deleteCtx(eventId: string) {
  return {
    request: new Request(`http://localhost/api/events/${eventId}/follow`, { method: "DELETE" }),
    params: { id: eventId },
  } as any;
}

async function seedUser(id = "follow-user") {
  return prisma.user.create({
    data: { id, name: "Follow User", email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEvent() {
  return prisma.event.create({
    data: { title: "Follow Test", location: "Pitch", dateTime: new Date(), maxPlayers: 10 },
  });
}

beforeEach(async () => {
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await resetApiRateLimitStore();
  vi.clearAllMocks();
});

describe("DELETE /api/events/[id]/follow", () => {
  it("lets a player unfollow while staying on the roster", async () => {
    const user = await seedUser();
    const event = await seedEvent();
    // Player row linked to the account — user is on the roster AND following.
    await prisma.player.create({ data: { eventId: event.id, name: user.name, userId: user.id, order: 0 } });
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: user.id } });

    mockAuthenticateRequest.mockResolvedValue({ userId: user.id } as any);
    mockGetSession.mockResolvedValue({ user: { id: user.id, name: user.name } } as any);

    const res = await DELETE(deleteCtx(event.id));
    expect(res.status).toBe(200);
    expect((await res.json()).following).toBe(false);

    const follow = await prisma.eventFollow.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: user.id } },
    });
    expect(follow).toBeNull();
    // Still on the roster — unfollowing must not remove their spot.
    const player = await prisma.player.findFirst({ where: { eventId: event.id, userId: user.id } });
    expect(player).not.toBeNull();
  });
});
