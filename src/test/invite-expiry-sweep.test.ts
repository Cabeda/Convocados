/**
 * Sweeping pending invites whose game has already kicked off (GH #1273 / dex
 * yobg93a).
 *
 * Prod evidence: event `cmmkfrx8b0000o2ixrix1yp2m` — 18 PlayerInvite rows, 4
 * still `status='pending'`, three of them invited 2026-08-21 for occurrences
 * that had long finished. `expirePendingInvites` is scoped to ONE gameId and
 * every one of its five production callers passes either the *current* game or
 * the invite's own game behind a human click, so the rows for a lapsed
 * occurrence were never revisited. The orphan-ghost heal kept the participants
 * table clean, which is exactly why the audit reported `orphans: 0` and the
 * broken invite rows went unnoticed for seven weeks.
 *
 * The invariant under test (ADR 0025): an invite may only stay `pending` while
 * its game can still be played. Once kickoff has passed it must be `expired`,
 * with its pending GameParticipant + Rsvp ghosts removed — whoever sweeps it.
 *
 * Scope is the GAME DATE, never the invite's age: an invite for a game a week
 * out is still actionable (regression guard for
 * `src/test/auth-api.test.ts:276`, where a future second game's invite must
 * stay pending).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const mockGetSession = vi.fn().mockResolvedValue(null);
const mockCheckEventAdmin = vi.fn().mockResolvedValue(false);
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: false, session: null }),
  checkEventAdmin: (...args: any[]) => mockCheckEventAdmin(...args),
}));
vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("~/lib/geocode", () => ({ resolveLocation: vi.fn() }));

import { POST as inviteExpiryCron } from "~/pages/api/cron/invite-expiry";
import { createPlayerInvite, expirePastGameInvites } from "~/lib/invite.server";

function cronCtx(secret?: string) {
  return {
    request: new Request("http://localhost/api/test", {
      method: "POST",
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    }),
    params: {},
    url: new URL("http://localhost/api/test"),
  } as any;
}

function eid() {
  return `e-${Math.random().toString(36).slice(2, 8)}`;
}

async function seedUser(name: string) {
  return prisma.user.create({
    data: {
      id: `u-${name}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      email: `${name.replace(/\s+/g, ".")}@t.com`,
      emailVerified: true,
    },
  });
}

/** An event plus one game at `dateTime`, optionally wired as the current game. */
async function seedEventWithGame(
  ownerId: string,
  dateTime: Date,
  extra: { isRecurring?: boolean; recurrenceRule?: string | null; currentGameId?: boolean } = {},
) {
  const event = await prisma.event.create({
    data: {
      id: eid(),
      title: "Game",
      location: "Pitch",
      dateTime,
      ownerId,
      maxPlayers: 10,
      durationMinutes: 60,
      isRecurring: extra.isRecurring ?? false,
      recurrenceRule: extra.recurrenceRule ?? null,
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime } });
  if (extra.currentGameId !== false) {
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  }
  return { ...event, gameId: game.id, currentGameId: game.id };
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  mockCheckEventAdmin.mockResolvedValue(false);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.webhookDelivery.deleteMany();
  await prisma.webhookSubscription.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.notificationJob.deleteMany();
  await prisma.playerInvite.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.priorityEnrollment.deleteMany();
  await prisma.notificationPreferences.deleteMany();
  await prisma.appPushToken.deleteMany();
  await prisma.pushSubscription.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("expirePastGameInvites", () => {
  it("expires a pending invite whose game kicked off 7 weeks ago and cleans its ghosts", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Stale Invitee");
    // A one-off event — the worst case for every current call site, none of
    // which can reach a game that is no longer the event's current one.
    const ev = await seedEventWithGame(owner.id, new Date(Date.now() - 49 * 86_400_000));
    const invite = await createPlayerInvite({
      eventId: ev.id,
      gameId: ev.currentGameId!,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://x.dev",
      delivery: "link-only",
    });
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: invitee.id } });
    await prisma.rsvp.create({ data: { eventPlayerId: ep.id, gameId: ev.currentGameId!, status: "yes" } });

    const expired = await expirePastGameInvites();

    expect(expired).toBe(1);
    const saved = await prisma.playerInvite.findUniqueOrThrow({ where: { id: invite.inviteId } });
    expect(saved.status).toBe("expired");
    expect(
      await prisma.gameParticipant.count({ where: { gameId: ev.currentGameId!, eventPlayerId: ep.id } }),
    ).toBe(0);
    expect(await prisma.rsvp.count({ where: { gameId: ev.currentGameId!, eventPlayerId: ep.id } })).toBe(0);
  });

  it("leaves invites for a future game pending — expiry is scoped by kickoff, not by invite age", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Future Invitee");
    // The same eventPlayer has a stale invite on an old occurrence AND a
    // legitimate one a week out. Only the old one may go.
    const rule = JSON.stringify({ freq: "weekly", interval: 1 });
    const old = await seedEventWithGame(
      owner.id,
      new Date(Date.now() - 7 * 86_400_000),
      { isRecurring: true, recurrenceRule: rule, currentGameId: false },
    );
    const upcoming = new Date(Date.now() + 7 * 86_400_000);
    const current = await seedEventWithGame(owner.id, upcoming, { isRecurring: true, recurrenceRule: rule });
    const stale = await createPlayerInvite({
      eventId: old.id,
      gameId: old.currentGameId!,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://x.dev",
      delivery: "link-only",
    });
    const live = await createPlayerInvite({
      eventId: current.id,
      gameId: current.currentGameId!,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://x.dev",
      delivery: "link-only",
    });

    expect(await expirePastGameInvites()).toBe(1);

    expect((await prisma.playerInvite.findUniqueOrThrow({ where: { id: stale.inviteId } })).status).toBe("expired");
    // Still actionable: the game has not kicked off.
    expect((await prisma.playerInvite.findUniqueOrThrow({ where: { id: live.inviteId } })).status).toBe("pending");
    const ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: current.id, userId: invitee.id } });
    expect(
      await prisma.gameParticipant.count({ where: { gameId: current.currentGameId!, eventPlayerId: ep.id } }),
    ).toBe(1);
  });

  it("does not disturb already-answered invites on a past game", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Answered Invitee");
    const ev = await seedEventWithGame(owner.id, new Date(Date.now() - 1000));

    const declined = await createPlayerInvite({
      eventId: ev.id,
      gameId: ev.currentGameId!,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://x.dev",
      delivery: "link-only",
    });
    await prisma.playerInvite.update({ where: { id: declined.inviteId }, data: { status: "declined" } });

    expect(await expirePastGameInvites()).toBe(0);
    expect((await prisma.playerInvite.findUniqueOrThrow({ where: { id: declined.inviteId } })).status).toBe("declined");
  });

  it("is a no-op when no invite is past its kickoff", async () => {
    const owner = await seedUser("Owner");
    const invitee = await seedUser("Invitee");
    const ev = await seedEventWithGame(owner.id, new Date(Date.now() + 48 * 3600_000));
    await createPlayerInvite({
      eventId: ev.id,
      gameId: ev.currentGameId!,
      inviteeUserId: invitee.id,
      invitedByUserId: owner.id,
      origin: "https://x.dev",
      delivery: "link-only",
    });

    expect(await expirePastGameInvites()).toBe(0);
    expect(await prisma.playerInvite.count({ where: { status: "pending" } })).toBe(1);
  });
});

describe("POST /api/cron/invite-expiry", () => {
  it("rejects 401 when CRON_SECRET is unset (fail-closed)", async () => {
    const res = await inviteExpiryCron(cronCtx());
    expect(res.status).toBe(401);
  });

  it("rejects 401 on a wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "secret123");
    try {
      const res = await inviteExpiryCron(cronCtx("wrong"));
      expect(res.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("expires the past-game invites it can reach and reports the count", async () => {
    vi.stubEnv("CRON_SECRET", "secret123");
    try {
      const owner = await seedUser("Owner");
      const staleInvitee = await seedUser("Stale Invitee");
      const liveInvitee = await seedUser("Live Invitee");
      const stale = await seedEventWithGame(owner.id, new Date(Date.now() - 49 * 86_400_000));
      const live = await seedEventWithGame(owner.id, new Date(Date.now() + 48 * 3600_000));
      const staleInvite = await createPlayerInvite({
        eventId: stale.id,
        gameId: stale.currentGameId!,
        inviteeUserId: staleInvitee.id,
        invitedByUserId: owner.id,
        origin: "https://x.dev",
        delivery: "link-only",
      });
      const liveInvite = await createPlayerInvite({
        eventId: live.id,
        gameId: live.currentGameId!,
        inviteeUserId: liveInvitee.id,
        invitedByUserId: owner.id,
        origin: "https://x.dev",
        delivery: "link-only",
      });

      const res = await inviteExpiryCron(cronCtx("secret123"));

      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, expired: 1 });
      expect((await prisma.playerInvite.findUniqueOrThrow({ where: { id: staleInvite.inviteId } })).status).toBe("expired");
      expect((await prisma.playerInvite.findUniqueOrThrow({ where: { id: liveInvite.inviteId } })).status).toBe("pending");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
