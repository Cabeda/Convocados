import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/players";
import { getSession } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { sendPushToUser } from "~/lib/push.server";
import { sendPlayerInviteToRegister } from "~/lib/email.server";

vi.mock("~/lib/auth.helpers.server", () => ({ getSession: vi.fn() }));
vi.mock("~/lib/push.server", () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }));
// Keep the other email exports working; only stub the network senders we assert on.
vi.mock("~/lib/email.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/email.server")>();
  return {
    ...actual,
    sendPlayerInviteToRegister: vi.fn().mockResolvedValue(undefined),
    sendGameInvite: vi.fn().mockResolvedValue(undefined),
    sendPlayerJoinedOwnerNotification: vi.fn().mockResolvedValue(undefined),
  };
});

const mockGetSession = vi.mocked(getSession);
const mockPush = vi.mocked(sendPushToUser);
const mockInviteEmail = vi.mocked(sendPlayerInviteToRegister);

function ctx(eventId: string, body: unknown, session: { user: { id: string; name: string } } | null) {
  mockGetSession.mockResolvedValue(session as any);
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/players`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": "test-client" },
      body: JSON.stringify(body),
    }),
  } as any;
}

async function seedEvent(ownerId: string | null = null) {
  return prisma.event.create({
    data: { title: "Pickup Game", location: "Pitch", dateTime: new Date(Date.now() + 86400_000), maxPlayers: 10, ownerId },
  });
}

beforeEach(async () => {
  await prisma.playerRating.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

describe("POST /api/events/[id]/players — invite by email", () => {
  it("notifies a registered user (push) and links the player to their account", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@t.com", emailVerified: true } });
    const friend = await prisma.user.create({ data: { id: "u-friend", name: "Friend", email: "friend@t.com", emailVerified: true } });
    const event = await seedEvent(owner.id);

    const res = await POST(ctx(event.id, { name: "Friend Smith", email: "friend@t.com" }, { user: { id: owner.id, name: "Owner" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, invited: "notified" });

    expect(mockPush).toHaveBeenCalledWith(friend.id, "Pickup Game", expect.stringContaining("added you"), expect.any(String));
    expect(mockInviteEmail).not.toHaveBeenCalled();

    const player = await prisma.player.findFirst({ where: { eventId: event.id, name: "Friend Smith" } });
    expect(player?.userId).toBe(friend.id);
  });

  it("emails an invite to register when the email is not a registered user", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@t.com", emailVerified: true } });
    const event = await seedEvent(owner.id);

    const res = await POST(ctx(event.id, { name: "New Guy", email: "newguy@example.com" }, { user: { id: owner.id, name: "Owner" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, invited: "emailed" });

    expect(mockInviteEmail).toHaveBeenCalledWith(
      "newguy@example.com",
      expect.objectContaining({ eventTitle: "Pickup Game", inviterName: "Owner" }),
    );
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("ignores a malformed email (no notify, no invite) but still adds the player", async () => {
    const event = await seedEvent();
    const res = await POST(ctx(event.id, { name: "Plain", email: "not-an-email" }, null));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, invited: null });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockInviteEmail).not.toHaveBeenCalled();
    expect(await prisma.player.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("does not notify when the adder invites themselves by email", async () => {
    const self = await prisma.user.create({ data: { id: "u-self", name: "Self", email: "self@t.com", emailVerified: true } });
    const event = await seedEvent(self.id);
    const res = await POST(ctx(event.id, { name: "Self", email: "self@t.com" }, { user: { id: self.id, name: "Self" } }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, invited: null });
    expect(mockPush).not.toHaveBeenCalled();
  });
});
