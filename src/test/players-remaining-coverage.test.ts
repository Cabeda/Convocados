import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST, removePlayerFromTeams, resetInviteRateLimitStores } from "~/pages/api/events/[id]/players";
import { getSession } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { sendPushToUser } from "~/lib/push.server";
import { sendPlayerInviteToRegister, sendGameInvite, sendPlayerJoinedOwnerNotification } from "~/lib/email.server";

vi.mock("~/lib/auth.helpers.server", () => ({ getSession: vi.fn(), checkOwnership: vi.fn() }));
vi.mock("~/lib/push.server", () => ({ sendPushToUser: vi.fn().mockResolvedValue(undefined) }));
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
const mockGameInvite = vi.mocked(sendGameInvite);
const mockOwnerNotify = vi.mocked(sendPlayerJoinedOwnerNotification);

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

async function seedEvent(opts: { ownerId?: string | null; balanced?: boolean; maxPlayers?: number; teamNames?: boolean } = {}) {
  return prisma.event.create({
    data: {
      title: "Pickup Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: opts.maxPlayers ?? 10,
      ownerId: opts.ownerId ?? null,
      balanced: opts.balanced ?? false,
      ...(opts.teamNames ? { teamOneName: "Ninjas", teamTwoName: "Gunas" } : {}),
    },
  });
}

beforeEach(async () => {
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.notificationJob.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  resetInviteRateLimitStores();
  vi.clearAllMocks();
});

describe("players.ts remaining coverage — team edges", () => {
  it("removePlayerFromTeams on a balanced event with a single team calls tryBalancedSwap and returns early", async () => {
    const event = await seedEvent({ balanced: true, teamNames: true });

    await prisma.player.create({ data: { name: "P0", eventId: event.id, order: 0 } });
    await prisma.player.create({ data: { name: "P10", eventId: event.id, order: 10 } });
    const team = await prisma.teamResult.create({
      data: {
        name: "Ninjas",
        eventId: event.id,
        members: { create: [{ name: "P0", order: 0 }] },
      },
    });

    // Balanced event but only 1 team → skips the full-rebalance branch, removes
    // P0, promotes P10, then re-checks balanced and calls tryBalancedSwap, which
    // returns early because there aren't exactly 2 teams.
    await removePlayerFromTeams(event.id, "P0", "P10");

    const teams = await prisma.teamResult.findMany({ where: { eventId: event.id }, include: { members: true } });
    expect(teams).toHaveLength(1);
    expect(teams[0].members.map((m) => m.name)).toEqual(["P10"]);
    expect(team.id).toBeTruthy();
  });
});

describe("players.ts remaining coverage — POST paths", () => {
  it("auto-randomizes a balanced event with ratings when it becomes full", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner", name: "Owner", email: "owner@t.com", emailVerified: true } });
    const event = await seedEvent({ ownerId: owner.id, balanced: true, maxPlayers: 2, teamNames: true });

    const res1 = await POST(ctx(event.id, { name: "A" }, { user: { id: owner.id, name: "Owner" } }));
    expect(res1.status).toBe(200);
    const res2 = await POST(ctx(event.id, { name: "B" }, { user: { id: owner.id, name: "Owner" } }));
    expect(res2.status).toBe(200);

    const teams = await prisma.teamResult.findMany({ where: { eventId: event.id } });
    expect(teams).toHaveLength(2);
  });

  it("auto-randomizes with default ratings when the balanced event is full", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner2", name: "Owner2", email: "owner2@t.com", emailVerified: true } });
    const event = await seedEvent({ ownerId: owner.id, balanced: true, maxPlayers: 2, teamNames: true });

    // Seed ratings for the two players so the balanced path reads them.
    await prisma.playerRating.create({ data: { eventId: event.id, name: "A", rating: 1500 } });
    await prisma.playerRating.create({ data: { eventId: event.id, name: "B", rating: 1000 } });

    const res1 = await POST(ctx(event.id, { name: "A" }, { user: { id: owner.id, name: "Owner2" } }));
    expect(res1.status).toBe(200);
    const res2 = await POST(ctx(event.id, { name: "B" }, { user: { id: owner.id, name: "Owner2" } }));
    expect(res2.status).toBe(200);

    const teams = await prisma.teamResult.findMany({ where: { eventId: event.id } });
    expect(teams).toHaveLength(2);
  });

  it("returns 409 when re-adding a player linked to the same account", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner3", name: "Owner3", email: "owner3@t.com", emailVerified: true } });
    const friend = await prisma.user.create({ data: { id: "u-friend3", name: "Alex", email: "alex@t.com", emailVerified: true } });
    const event = await seedEvent({ ownerId: owner.id });

    await prisma.player.create({ data: { name: "Alex", eventId: event.id, order: 0, userId: friend.id } });

    const res = await POST(ctx(event.id, { name: "Alex", email: "alex@t.com" }, { user: { id: owner.id, name: "Owner3" } }));
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error).toContain("already in the list");
  });

  it("sends a game invite email to a linked player who opted into game invite emails", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner4", name: "Owner4", email: "owner4@t.com", emailVerified: true } });
    const player = await prisma.user.create({ data: { id: "u-player4", name: "Pat", email: "pat@t.com", emailVerified: true } });
    await prisma.notificationPreferences.create({
      data: { userId: player.id, emailEnabled: true, gameInviteEmail: true },
    });
    const event = await seedEvent({ ownerId: owner.id });

    // QuickJoin: linkToAccount true with the session user → linkedUserId set.
    const res = await POST(ctx(event.id, { name: "Pat", linkToAccount: true }, { user: { id: player.id, name: "Pat" } }));
    expect(res.status).toBe(200);
    expect(mockGameInvite).toHaveBeenCalledWith(
      "pat@t.com",
      expect.objectContaining({ eventTitle: "Pickup Game" }),
    );
  });

  it("notifies the event owner by email when a player joins and the owner opted in", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner5", name: "Owner5", email: "owner5@t.com", emailVerified: true } });
    await prisma.notificationPreferences.create({
      data: { userId: owner.id, emailEnabled: true, gameInviteEmail: true },
    });
    const event = await seedEvent({ ownerId: owner.id });

    const res = await POST(ctx(event.id, { name: "Newbie" }, { user: { id: "u-admin5", name: "Admin" } }));
    expect(res.status).toBe(200);
    expect(mockOwnerNotify).toHaveBeenCalledWith(
      "owner5@t.com",
      expect.objectContaining({ eventTitle: "Pickup Game", playerName: "Newbie" }),
    );
  });

  it("logs a failed invite push but still succeeds", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner6", name: "Owner6", email: "owner6@t.com", emailVerified: true } });
    await prisma.user.create({ data: { id: "u-friend6", name: "Friend6", email: "friend6@t.com", emailVerified: true } });
    const event = await seedEvent({ ownerId: owner.id });

    mockPush.mockRejectedValueOnce(new Error("push down"));

    const res = await POST(ctx(event.id, { name: "Friend6", email: "friend6@t.com" }, { user: { id: owner.id, name: "Owner6" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, invited: null });
  });

  it("logs a failed invite email but still succeeds", async () => {
    const owner = await prisma.user.create({ data: { id: "u-owner7", name: "Owner7", email: "owner7@t.com", emailVerified: true } });
    const event = await seedEvent({ ownerId: owner.id });

    mockInviteEmail.mockRejectedValueOnce(new Error("smtp down"));

    const res = await POST(ctx(event.id, { name: "New Guy", email: "newguy@example.com" }, { user: { id: owner.id, name: "Owner7" } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, invited: null });
  });
});
