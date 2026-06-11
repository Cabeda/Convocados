import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST, resetInviteRateLimitStores } from "~/pages/api/events/[id]/players";
import { getSession } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { sendPushToUser } from "~/lib/push.server";
import { sendPlayerInviteToRegister } from "~/lib/email.server";

vi.mock("~/lib/auth.helpers.server", () => ({ getSession: vi.fn(), checkOwnership: vi.fn() }));
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
  resetInviteRateLimitStores();
  vi.clearAllMocks();
});

describe("POST /api/events/[id]/players — invite by email", () => {
  it("notifies a registered user (push) and links the player to their account", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@t.com", emailVerified: true } });
    const friend = await prisma.user.create({ data: { id: "u-friend", name: "Friend", email: "friend@t.com", emailVerified: true } });
    const event = await seedEvent(owner.id);

    const res = await POST(ctx(event.id, { name: "Friend Smith", email: "friend@t.com" }, { user: { id: owner.id, name: "Owner" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, invited: "notified", resolvedName: "Friend" });

    expect(mockPush).toHaveBeenCalledWith(friend.id, "Pickup Game", expect.stringContaining("added you"), expect.any(String));
    expect(mockInviteEmail).not.toHaveBeenCalled();

    // Email resolves → uses User.name ("Friend"), not the client-provided "Friend Smith"
    const player = await prisma.player.findFirst({ where: { eventId: event.id, name: "Friend" } });
    expect(player?.userId).toBe(friend.id);
  });

  it("emails an invite to register when the email is not a registered user", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@t.com", emailVerified: true } });
    const event = await seedEvent(owner.id);

    const res = await POST(ctx(event.id, { name: "New Guy", email: "newguy@example.com" }, { user: { id: owner.id, name: "Owner" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, invited: "emailed", resolvedName: "New Guy" });

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
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, invited: null, resolvedName: "Plain" });
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockInviteEmail).not.toHaveBeenCalled();
    expect(await prisma.player.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("does not notify when the adder invites themselves by email", async () => {
    const self = await prisma.user.create({ data: { id: "u-self", name: "Self", email: "self@t.com", emailVerified: true } });
    const event = await seedEvent(self.id);
    const res = await POST(ctx(event.id, { name: "Self", email: "self@t.com" }, { user: { id: self.id, name: "Self" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, invited: null });
    expect(mockPush).not.toHaveBeenCalled();
  });

  // ── New tests ────────────────────────────────────────────────────────────────

  it("unauthenticated callers adding with email do NOT send invite emails", async () => {
    const event = await seedEvent();
    const res = await POST(ctx(event.id, { name: "Anon Player", email: "someone@example.com" }, null));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, invited: null });
    expect(mockInviteEmail).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
    // Player was still added
    expect(await prisma.player.count({ where: { eventId: event.id } })).toBe(1);
  });

  it("per-event rate limit: 11th unique email is skipped", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@t.com", emailVerified: true } });
    const event = await seedEvent(owner.id);

    // Send 10 successful invites
    for (let i = 0; i < 10; i++) {
      const res = await POST(ctx(event.id, { name: `Player ${i}`, email: `user${i}@ext.com` }, { user: { id: owner.id, name: "Owner" } }));
      expect(res.status).toBe(200);
    }
    expect(mockInviteEmail).toHaveBeenCalledTimes(10);

    // 11th should be skipped
    mockInviteEmail.mockClear();
    const res = await POST(ctx(event.id, { name: "Player 10", email: "user10@ext.com" }, { user: { id: owner.id, name: "Owner" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.invited).toBeNull(); // email skipped, player still added
    expect(mockInviteEmail).not.toHaveBeenCalled();
    expect(await prisma.player.count({ where: { eventId: event.id, name: "Player 10" } })).toBe(1);
  });

  it("name-empty + email resolves to registered user → uses User.name", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@t.com", emailVerified: true } });
    const friend = await prisma.user.create({ data: { id: "u-friend", name: "Jane Doe", email: "jane@t.com", emailVerified: true } });
    const event = await seedEvent(owner.id);

    const res = await POST(ctx(event.id, { name: "", email: "jane@t.com" }, { user: { id: owner.id, name: "Owner" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.resolvedName).toBe("Jane Doe");

    const player = await prisma.player.findFirst({ where: { eventId: event.id, name: "Jane Doe" } });
    expect(player).not.toBeNull();
    expect(player?.userId).toBe(friend.id);
  });

  it("name-empty + email does NOT resolve → returns 400", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@t.com", emailVerified: true } });
    const event = await seedEvent(owner.id);

    const res = await POST(ctx(event.id, { name: "", email: "unknown@nowhere.com" }, { user: { id: owner.id, name: "Owner" } }));
    expect(res.status).toBe(400);
  });

  it("P2002 merge: existing unlinked player gets userId set", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@t.com", emailVerified: true } });
    const friend = await prisma.user.create({ data: { id: "u-friend", name: "Alex", email: "alex@t.com", emailVerified: true } });
    const event = await seedEvent(owner.id);

    // Pre-existing unlinked player named "Alex"
    await prisma.player.create({ data: { name: "Alex", eventId: event.id, order: 0 } });

    // Add by email → resolves to User "Alex", triggers P2002, should merge
    const res = await POST(ctx(event.id, { name: "Alex", email: "alex@t.com" }, { user: { id: owner.id, name: "Owner" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, resolvedName: "Alex" });

    // Verify the existing player now has userId linked
    const player = await prisma.player.findUnique({ where: { eventId_name: { eventId: event.id, name: "Alex" } } });
    expect(player?.userId).toBe(friend.id);
  });

  it("P2002 reject: existing player linked to different user", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@t.com", emailVerified: true } });
    const other = await prisma.user.create({ data: { id: "u-other", name: "Bob", email: "bob@t.com", emailVerified: true } });
    const _friend = await prisma.user.create({ data: { id: "u-friend", name: "Bob", email: "bob2@t.com", emailVerified: true } });
    const event = await seedEvent(owner.id);

    // Pre-existing player "Bob" linked to "u-other"
    await prisma.player.create({ data: { name: "Bob", eventId: event.id, order: 0, userId: other.id } });

    // Try to add by email (bob2@t.com resolves to friend whose name is "Bob")
    const res = await POST(ctx(event.id, { name: "Bob", email: "bob2@t.com" }, { user: { id: owner.id, name: "Owner" } }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("different account");
  });

  it("resolvedName is returned in the response", async () => {
    const event = await seedEvent();
    const res = await POST(ctx(event.id, { name: "Test Player" }, null));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.resolvedName).toBe("Test Player");
  });
});
