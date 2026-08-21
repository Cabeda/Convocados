import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock auth helpers — default to unauthenticated, tests override as needed
const mockGetSession = vi.fn().mockResolvedValue(null);
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: false, isAdmin: false, session: null }),
  checkEventAdmin: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("~/lib/geocode", () => ({
  resolveLocation: vi.fn(),
}));

import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { POST as toggleInviteOptOut } from "~/pages/api/events/[id]/invitation-opt-out";
import { getRsvpRecipients, getRsvpSummary } from "~/lib/rsvp.server";
import { getPingSuppressedUserIds } from "~/lib/inviteOptOut.server";
import { wantsInvites } from "~/lib/notificationPrefs.server";
import { DEFAULTS } from "~/lib/notificationPrefs.server";

function ctx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? "POST" : "GET",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

function eid() { return `e-${Math.random().toString(36).slice(2, 8)}`; }

async function seedUser(name: string, id?: string) {
  return prisma.user.create({
    data: { id: id ?? `u-${name}`, name, email: `${name}@t.com`, emailVerified: true },
  });
}

/** ADR 0016 world: event + current game + linked EventPlayer + legacy Player row. */
async function seedEventWithGame(ownerId: string | null) {
  const event = await prisma.event.create({
    data: { id: eid(), title: "Game", location: "Pitch", dateTime: new Date(Date.now() + 48 * 3600_000), ownerId },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

async function seedLinkedPlayer(eventId: string, user: { id: string; name: string }, order: number) {
  const player = await prisma.player.create({ data: { eventId, name: user.name, userId: user.id, order } });
  const ep = await prisma.eventPlayer.create({ data: { eventId, name: user.name, userId: user.id } });
  await prisma.gameParticipant.create({ data: { gameId: (await prisma.event.findUniqueOrThrow({ where: { id: eventId } })).currentGameId!, eventPlayerId: ep.id, order } });
  return { player, ep };
}

async function seedRsvp(epId: string, gameId: string, status: "yes" | "no" | "maybe") {
  return prisma.rsvp.create({ data: { eventPlayerId: epId, gameId, status, respondedAt: new Date() } });
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.rsvp.deleteMany();
  await prisma.playerInvite.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("getRsvpRecipients — ADR 0025 suppression", () => {
  it("excludes a user who declined (rsvp=no) the current game", async () => {
    const owner = await seedUser("Owner");
    const player = await seedUser("Player");
    const decliner = await seedUser("Decliner");
    const ev = await seedEventWithGame(owner.id);
    await seedLinkedPlayer(ev.id, player, 0);
    const declinerEp = (await seedLinkedPlayer(ev.id, decliner, 1)).ep;
    await seedRsvp(declinerEp.id, ev.currentGameId, "no");

    const recipients = await getRsvpRecipients(ev.id);
    expect(recipients).toContain(owner.id);
    expect(recipients).toContain(player.id);
    expect(recipients).not.toContain(decliner.id);
  });

  it("excludes a user who opted out of invites for this event", async () => {
    const owner = await seedUser("Owner");
    const player = await seedUser("Player");
    const optedOut = await seedUser("OptedOut");
    const ev = await seedEventWithGame(owner.id);
    await seedLinkedPlayer(ev.id, player, 0);
    await prisma.eventPlayer.create({ data: { eventId: ev.id, name: optedOut.name, userId: optedOut.id, invitationOptOutAt: new Date() } });

    const recipients = await getRsvpRecipients(ev.id);
    expect(recipients).not.toContain(optedOut.id);
  });

  it("keeps 'maybe' users — they still get the cutoff ping", async () => {
    const owner = await seedUser("Owner");
    const maybe = await seedUser("Maybe");
    const ev = await seedEventWithGame(owner.id);
    const maybeEp = (await seedLinkedPlayer(ev.id, maybe, 0)).ep;
    await seedRsvp(maybeEp.id, ev.currentGameId, "maybe");

    const recipients = await getRsvpRecipients(ev.id);
    expect(recipients).toContain(maybe.id);
  });

  it("suppression is per-game: declined users return after a recurrence reset", async () => {
    const owner = await seedUser("Owner");
    const decliner = await seedUser("Decliner");
    const ev = await seedEventWithGame(owner.id);
    const declinerEp = (await seedLinkedPlayer(ev.id, decliner, 0)).ep;
    await seedRsvp(declinerEp.id, ev.currentGameId, "no");

    // Recurrence reset: new current game, fresh pending Rsvp
    const game2 = await prisma.game.create({ data: { eventId: ev.id, dateTime: new Date(Date.now() + 7 * 86400_000) } });
    await prisma.event.update({ where: { id: ev.id }, data: { currentGameId: game2.id } });

    const recipients = await getRsvpRecipients(ev.id);
    expect(recipients).toContain(decliner.id);
  });
});

describe("getRsvpSummary — counts stay complete", () => {
  it("still counts declined users in the no bucket (suppression off for counts)", async () => {
    const owner = await seedUser("Owner");
    const decliner = await seedUser("Decliner");
    const ev = await seedEventWithGame(owner.id);
    const declinerEp = (await seedLinkedPlayer(ev.id, decliner, 0)).ep;
    await seedRsvp(declinerEp.id, ev.currentGameId, "no");

    const summary = await getRsvpSummary(ev.id);
    expect(summary.no).toBe(1);
    expect(summary.noUserIds).toContain(decliner.id);
  });
});

describe("getPingSuppressedUserIds", () => {
  it("returns declined + opted-out users", async () => {
    const owner = await seedUser("Owner");
    const decliner = await seedUser("Decliner");
    const optedOut = await seedUser("OptedOut");
    const ev = await seedEventWithGame(owner.id);
    const declinerEp = (await seedLinkedPlayer(ev.id, decliner, 0)).ep;
    await seedRsvp(declinerEp.id, ev.currentGameId, "no");
    await prisma.eventPlayer.create({ data: { eventId: ev.id, name: optedOut.name, userId: optedOut.id, invitationOptOutAt: new Date() } });

    const suppressed = await getPingSuppressedUserIds(ev.id);
    expect(suppressed.has(decliner.id)).toBe(true);
    expect(suppressed.has(optedOut.id)).toBe(true);
    expect(suppressed.has(owner.id)).toBe(false);
  });
});

describe("wantsInvites — ADR 0025 global kill switch", () => {
  it("defaults to true", () => {
    expect(wantsInvites(DEFAULTS)).toBe(true);
  });

  it("returns false when the user opted out globally", () => {
    expect(wantsInvites({ ...DEFAULTS, invitesEnabled: false })).toBe(false);
  });
});

describe("GET /api/events/[id] — declined roster + opt-out state", () => {
  it("returns declined entries for a participant viewer", async () => {
    const owner = await seedUser("Owner");
    const participant = await seedUser("Participant");
    const decliner = await seedUser("Decliner");
    const ev = await seedEventWithGame(owner.id);
    await seedLinkedPlayer(ev.id, participant, 0);
    const declinerEp = (await seedLinkedPlayer(ev.id, decliner, 1)).ep;
    await seedRsvp(declinerEp.id, ev.currentGameId, "no");

    mockGetSession.mockResolvedValue({ user: { id: participant.id } });
    const res = await getEvent(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.declined).toHaveLength(1);
    expect(body.declined[0].name).toBe(decliner.name);
    expect(body.declined[0].userId).toBe(decliner.id);
  });

  it("returns empty declined for anonymous viewers", async () => {
    const owner = await seedUser("Owner");
    const decliner = await seedUser("Decliner");
    const ev = await seedEventWithGame(owner.id);
    const declinerEp = (await seedLinkedPlayer(ev.id, decliner, 0)).ep;
    await seedRsvp(declinerEp.id, ev.currentGameId, "no");

    const res = await getEvent(ctx({ id: ev.id }));
    const body = await res.json();
    expect(body.declined).toEqual([]);
  });

  it("includes invitationOptOutAt on player entries", async () => {
    const owner = await seedUser("Owner");
    const player = await seedUser("Player");
    const ev = await seedEventWithGame(owner.id);
    const { ep } = await seedLinkedPlayer(ev.id, player, 0);
    await prisma.eventPlayer.update({ where: { id: ep.id }, data: { invitationOptOutAt: new Date() } });

    const res = await getEvent(ctx({ id: ev.id }));
    const body = await res.json();
    const entry = body.players.find((p: { userId: string | null }) => p.userId === player.id);
    expect(entry).toBeDefined();
    expect(entry.invitationOptOutAt).toBeTruthy();
  });
});

describe("POST /api/events/[id]/invitation-opt-out", () => {
  it("toggles the per-event opt-out on and off", async () => {
    const user = await seedUser("Me");
    const ev = await seedEventWithGame(null);
    await prisma.eventPlayer.create({ data: { eventId: ev.id, name: user.name, userId: user.id } });

    mockGetSession.mockResolvedValue({ user: { id: user.id } });

    const on = await toggleInviteOptOut(ctx({ id: ev.id }, { optOut: true }));
    expect((await on.json()).optedOut).toBe(true);
    let ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: user.id } });
    expect(ep.invitationOptOutAt).not.toBeNull();

    const off = await toggleInviteOptOut(ctx({ id: ev.id }, { optOut: false }));
    expect((await off.json()).optedOut).toBe(false);
    ep = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: ev.id, userId: user.id } });
    expect(ep.invitationOptOutAt).toBeNull();
  });

  it("rejects users who are not in the event", async () => {
    const user = await seedUser("Stranger");
    const ev = await seedEventWithGame(null);
    mockGetSession.mockResolvedValue({ user: { id: user.id } });
    const res = await toggleInviteOptOut(ctx({ id: ev.id }, { optOut: true }));
    expect(res.status).toBe(404);
  });

  it("requires authentication", async () => {
    const ev = await seedEventWithGame(null);
    const res = await toggleInviteOptOut(ctx({ id: ev.id }, { optOut: true }));
    expect(res.status).toBe(401);
  });
});