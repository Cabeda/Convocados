/**
 * #1237 — a player who is on the roster must always be able to leave it.
 *
 * The player list is rendered from GameParticipant (ADR 0016), but the leave and
 * remove endpoints gate on the legacy Player row being un-archived. Reactivation
 * paths (accepting a re-invite, confirming a priority spot) put someone back on
 * the roster without clearing Player.archivedAt, which produced the reporter's
 * state: "it shows me on the list but if I click to leave it says I am not on
 * it" / "Clicking on the x on my name in the list does nothing". Two simultaneous
 * leaves do NOT produce it (a control below) — only a reactivation does.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import type * as AuthHelpers from "~/lib/auth.helpers.server";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(undefined),
  deliverInviteNotification: vi.fn().mockResolvedValue({ email: false, webPush: false, appPush: false }),
}));
vi.mock("~/lib/webhook.server", () => ({ fireWebhooks: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/payments.server", () => ({ syncPaymentsForEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/eventLog.server", () => ({ logEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("~/lib/auth.helpers.server", async (orig) => ({
  ...(await orig<typeof AuthHelpers>()),
  getSession: vi.fn(),
  checkEventAdmin: vi.fn().mockResolvedValue(false),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: false, isAdmin: false }),
}));

import { getSession, checkOwnership } from "~/lib/auth.helpers.server";
import { POST as leaveRoute } from "~/pages/api/events/[id]/leave";
import { DELETE as playersDelete } from "~/pages/api/events/[id]/players";
import { POST as rosterRoute } from "~/pages/api/events/[id]/roster";
import { POST as priorityConfirm } from "~/pages/api/events/[id]/priority/confirm";
import { POST as rsvpRoute } from "~/pages/api/events/[id]/players/[playerId]/rsvp";
import { GET as eventGet } from "~/pages/api/events/[id]/index";
import { acceptPlayerInvite, createPlayerInvite } from "~/lib/invite.server";

function req(url: string, { userId, ...init }: RequestInit & { userId?: string } = {}) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  headers.set("host", "convocados.test");
  if (userId) headers.set("x-test-user", userId);
  return new Request(url, { ...init, headers });
}
const asUser = (userId: string) =>
  vi.mocked(getSession).mockResolvedValue(
    { user: { id: userId, email: `${userId}@t.com`, name: "Alice" } } as any,
  );

let event: { id: string; currentGameId: string; maxPlayers: number; dateTime: Date };

beforeEach(async () => {
  await resetApiRateLimitStore();
  vi.clearAllMocks();
  for (const model of [
    prisma.priorityConfirmation, prisma.priorityEnrollment, prisma.playerInvite, prisma.rsvp,
    prisma.eventFollow, prisma.gameParticipant, prisma.eventPlayer, prisma.teamMember,
    prisma.teamResult, prisma.player, prisma.game, prisma.event, prisma.user,
  ]) {
    await (model as { deleteMany: () => Promise<unknown> }).deleteMany();
  }
  for (const id of ["u-owner", "u-alice", "u-bob"]) {
    await prisma.user.create({ data: { id, name: id === "u-alice" ? "Alice" : id, email: `${id}@t.com`, emailVerified: true } });
  }
  const dateTime = new Date(Date.now() + 7 * 86400_000);
  const created = await prisma.event.create({
    data: { title: "Ninjas", location: "Pitch", dateTime, ownerId: "u-owner", maxPlayers: 5 },
  });
  const game = await prisma.game.create({ data: { eventId: created.id, dateTime } });
  await prisma.event.update({ where: { id: created.id }, data: { currentGameId: game.id } });
  event = { ...created, currentGameId: game.id, dateTime };
});

/** Legacy Player + EventPlayer + GameParticipant — a fully-synced roster row. */
async function seedOnRoster(name: string, userId: string | null, order: number) {
  const player = await prisma.player.create({ data: { eventId: event.id, name, userId, order } });
  const eventPlayer = await prisma.eventPlayer.create({ data: { eventId: event.id, name, userId } });
  await prisma.gameParticipant.create({ data: { gameId: event.currentGameId, eventPlayerId: eventPlayer.id, order } });
  return player.id;
}

async function rosterNames() {
  const res = await (eventGet as any)({ params: { id: event.id }, request: req(`http://x/api/events/${event.id}`, { userId: "u-alice" }) });
  return ((await res.json()).players as any[]).map((p: { name: string }) => p.name);
}

const leave = (userId: string) =>
  leaveRoute({ params: { id: event.id }, request: req(`http://x/api/events/${event.id}/leave`, { method: "POST", userId }) } as any);

/** The x: DELETE /players with the EventPlayer id the event page hands out. */
const clickX = async (name: string, userId: string) => {
  const { id } = await prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name }, select: { id: true } });
  return playersDelete({
    params: { id: event.id },
    request: req(`http://x/api/events/${event.id}/players`, { method: "DELETE", body: JSON.stringify({ playerId: id }), userId }),
  } as any);
};

/** Re-invite Alice and have her accept, the way a re-activated player gets there. */
async function reactivateViaInvite() {
  const { token } = await createPlayerInvite({
    eventId: event.id, gameId: event.currentGameId, inviteeUserId: "u-alice",
    invitedByUserId: "u-owner", origin: "http://x", delivery: "link-only",
  });
  asUser("u-alice");
  await acceptPlayerInvite({ token, userId: "u-alice", eventId: event.id, gameId: event.currentGameId, maxPlayers: event.maxPlayers });
}

const playerIdOf = (name: string) =>
  prisma.player.findFirstOrThrow({ where: { eventId: event.id, name }, select: { id: true } }).then((p) => p.id);
const eventPlayerIdOf = (name: string) =>
  prisma.eventPlayer.findFirstOrThrow({ where: { eventId: event.id, name }, select: { id: true } }).then((p) => p.id);

/**
 * The reporter's whole complaint as one check: if the roster shows you, neither
 * the Leave button nor the x may answer "you are not a player". Describes the
 * contradiction, or null when healthy.
 */
async function strandedAs(name: string, userId: string): Promise<string | null> {
  if (!(await rosterNames()).includes(name)) return null;
  if ((await leave(userId)).status !== 404) return null;
  if ((await clickX(name, userId)).status !== 404) return null;
  return `${name} is on the roster but POST /leave → 404 and DELETE /players → 404`;
}

describe("#1237 — roster membership and the leave gate must agree", () => {
  it("plain leave removes the player everywhere, and a second leave is a 404", async () => {
    await seedOnRoster("Alice", "u-alice", 0);
    await seedOnRoster("Bob", "u-bob", 1);
    asUser("u-alice");

    expect((await leave("u-alice")).status).toBe(200);
    expect(await rosterNames()).not.toContain("Alice");
    expect(await strandedAs("Alice", "u-alice")).toBeNull();
    // Leaving again must not resurrect them. (It is not free: #1250 resolves
    // identity from the roster, which survives a soft archive, so the repeat still
    // runs the flow and writes a player_left_bench NotificationJob. Pre-existing on
    // main; pinned here so the next reader does not call it a no-op.)
    await leave("u-alice");
    expect(await rosterNames()).not.toContain("Alice");
  });

  it("re-adding through POST /roster leaves the player able to leave again", async () => {
    await seedOnRoster("Alice", "u-alice", 0);
    await seedOnRoster("Bob", "u-bob", 1);
    await leave("u-alice");

    const added = await rosterRoute({
      params: { id: event.id },
      request: req(`http://x/api/events/${event.id}/roster`, { method: "POST", body: JSON.stringify({ name: "Alice", userId: "u-alice" }), userId: "u-owner" }),
    } as any);
    expect(added.status).toBe(200);
    expect(await strandedAs("Alice", "u-alice")).toBeNull();
  });

  it("two simultaneous leaves never strand anyone", async () => {
    for (let round = 0; round < 5; round++) {
      await seedOnRoster("Alice", "u-alice", 0);
      await seedOnRoster("Bob", "u-bob", 1);
      const stagger = () => new Promise((resolve) => setTimeout(resolve, round % 4));
      await Promise.all([stagger().then(() => leave("u-alice")), stagger().then(() => leave("u-bob"))]);
      expect(await strandedAs("Alice", "u-alice"), `round ${round}`).toBeNull();
      expect(await strandedAs("Bob", "u-bob"), `round ${round}`).toBeNull();
      for (const m of [prisma.player, prisma.gameParticipant, prisma.eventPlayer, prisma.rsvp]) {
        await (m as { deleteMany: () => Promise<unknown> }).deleteMany();
      }
    }
  });

  it("a player re-activated by accepting a re-invite can still leave", async () => {
    await seedOnRoster("Alice", "u-alice", 0);
    await seedOnRoster("Bob", "u-bob", 1);
    asUser("u-alice");
    await leave("u-alice");
    expect(await rosterNames()).not.toContain("Alice");

    await reactivateViaInvite();

    expect(await strandedAs("Alice", "u-alice")).toBeNull();
  });

  it("the x removes a re-activated player", async () => {
    await seedOnRoster("Alice", "u-alice", 0);
    await seedOnRoster("Bob", "u-bob", 1);
    asUser("u-alice");
    await leave("u-alice");
    await reactivateViaInvite();

    expect((await clickX("Alice", "u-alice")).status).toBe(200);
    expect(await rosterNames()).not.toContain("Alice");
  });

  it("a player re-activated by confirming a priority spot can still leave", async () => {
    await seedOnRoster("Alice", "u-alice", 0);
    await seedOnRoster("Bob", "u-bob", 1);
    await prisma.priorityEnrollment.create({ data: { eventId: event.id, userId: "u-alice", optedIn: true } });
    await prisma.priorityConfirmation.create({
      data: { eventId: event.id, userId: "u-alice", gameDate: event.dateTime, status: "pending", notifiedAt: new Date(), deadline: new Date(Date.now() + 86400_000) },
    });
    asUser("u-alice");
    await leave("u-alice");
    expect(await rosterNames()).not.toContain("Alice");

    const confirmed = await priorityConfirm({
      params: { id: event.id },
      request: req(`http://x/api/events/${event.id}/priority/confirm`, { method: "POST", userId: "u-alice" }),
    } as any);
    expect(confirmed.status).toBe(200);

    expect(await strandedAs("Alice", "u-alice")).toBeNull();
  });

  it("an invitee who never had a legacy Player row can still leave", async () => {
    await seedOnRoster("Bob", "u-bob", 0);
    await reactivateViaInvite();
    expect(await rosterNames()).toContain("Alice");

    expect(await strandedAs("Alice", "u-alice")).toBeNull();
  });
});

/**
 * Healing the legacy row is a WRITE, so it must only happen on the way *in* to a
 * leave that was allowed. These are the states where it used to fire anyway —
 * before the route decided, or before the caller had proved who they were.
 */
describe("#1237 — a rejected leave must not change anything", () => {
  /** Alice left, then got re-invited: on the roster, Player row still archived. */
  async function strandAlice() {
    await seedOnRoster("Alice", "u-alice", 0);
    await seedOnRoster("Bob", "u-bob", 1);
    asUser("u-alice");
    await leave("u-alice");
    await reactivateViaInvite();
    expect((await prisma.player.findFirstOrThrow({ where: { eventId: event.id, name: "Alice" } })).archivedAt).toBeTruthy();
  }

  const aliceArchivedAt = () =>
    prisma.player.findFirstOrThrow({ where: { eventId: event.id, name: "Alice" } }).then((p) => p.archivedAt);

  it("an unauthenticated x on a stranded player is a 403 that changes nothing", async () => {
    await strandAlice();
    const before = await aliceArchivedAt();

    // No session at all: checkOwnership answers {isOwner:false,isAdmin:false}, so
    // an account-linked player is off limits — but the legacy row must not have
    // been un-archived on the way to that answer.
    vi.mocked(getSession).mockResolvedValue(undefined as any);
    const res = await clickX("Alice", "u-anonymous");

    expect(res.status).toBe(403);
    expect(await aliceArchivedAt()).toEqual(before);
  });

  it("another player's x on a stranded account-linked player is a 403 that changes nothing", async () => {
    await strandAlice();
    const before = await aliceArchivedAt();

    asUser("u-bob");
    const res = await clickX("Alice", "u-bob");

    expect(res.status).toBe(403);
    expect(await aliceArchivedAt()).toEqual(before);
  });

  it("a 403 does not promote the rejected player into the push Tier 2 audience", async () => {
    // push.server.ts reads Player.archivedAt to decide "is an active player"
    // (ADR 0017). Un-archiving on a rejected request silently moved someone into
    // the player-only notification tier they were never in.
    await strandAlice();
    asUser("u-bob");
    expect((await clickX("Alice", "u-bob")).status).toBe(403);

    const alice = await prisma.player.findFirstOrThrow({ where: { eventId: event.id, name: "Alice" } });
    expect(alice.archivedAt).toBeTruthy();
    const active = await prisma.player.findMany({ where: { eventId: event.id, archivedAt: null }, select: { name: true } });
    expect(active.map((p) => p.name)).toEqual(["Bob"]);
  });

  it("two concurrent leaves by an invitee with no legacy row never 500", async () => {
    await seedOnRoster("Bob", "u-bob", 0);
    await reactivateViaInvite();
    asUser("u-alice");

    const statuses = (await Promise.all([leave("u-alice"), leave("u-alice")])).map((r) => r.status);

    expect(statuses.every((s) => s < 500)).toBe(true);
    expect(statuses).toContain(200);
    expect(await rosterNames()).not.toContain("Alice");
    // No legacy Player row was ever created for this invitee — still none, and
    // definitely not an un-archived one.
    expect(await prisma.player.count({ where: { eventId: event.id, name: "Alice", archivedAt: null } })).toBe(0);
  });

  it("a roster row with no userId is still gated on the Player row's account", async () => {
    // gameDualWrite creates EventPlayers with no userId and writes *active*
    // participants (reachable via PATCH .../history/{historyId}). "No userId on the
    // roster row" therefore does not mean anonymous — the archived Player row holds
    // the authoritative link. Trusting the roster row alone skips the gate, and an
    // unauthenticated x then removes an account-linked player instead of 403ing.
    const alice = await seedOnRoster("Alice", "u-alice", 0);
    await prisma.eventPlayer.update({
      where: { id: await eventPlayerIdOf("Alice") },
      data: { userId: null },
    });
    await prisma.player.update({ where: { id: alice }, data: { archivedAt: new Date() } });

    vi.mocked(getSession).mockResolvedValue(undefined as any);
    const res = await clickX("Alice", "u-anonymous");

    expect(res.status).toBe(403);
    const row = await prisma.player.findFirstOrThrow({ where: { id: alice } });
    expect(row.archivedAt).toBeTruthy();
  });

  it("the x does not act on a pending invite ghost", async () => {
    // ADR 0025: a pending participant is an invite, not a player — never part of the
    // roster, and retracted by its own action. Resolving the EventPlayer id without
    // checking the roster would let any anonymous caller cancel someone's invite.
    await seedOnRoster("Bob", "u-bob", 0);
    const ghost = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Ghost" } });
    await prisma.gameParticipant.create({
      data: { gameId: event.currentGameId, eventPlayerId: ghost.id, order: 1, status: "pending" },
    });

    vi.mocked(getSession).mockResolvedValue(undefined as any);
    const res = await playersDelete({
      params: { id: event.id },
      request: req(`http://x/api/events/${event.id}/players`, {
        method: "DELETE",
        body: JSON.stringify({ playerId: ghost.id }),
      }),
    } as any);

    expect(res.status).toBe(404);
    const participant = await prisma.gameParticipant.findFirstOrThrow({ where: { eventPlayerId: ghost.id } });
    expect(participant.archivedAt).toBeNull();
    expect(participant.status).toBe("pending");
  });

  it("an account with a ghost EventPlayer row still leaves the row it is on", async () => {
    // priority/confirm upserts EventPlayer by (eventId, name) with the caller's
    // *current* display name, so a renamed account legitimately owns two rows — and
    // EventPlayer is not unique on userId. An unordered findFirst lands on the ghost,
    // so the leave succeeds (200) while archiving nothing: the player stays on the
    // list, still unable to leave. Asserting the status alone hides that, so assert
    // *who* actually left.
    await seedOnRoster("Bob", "u-bob", 0);
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: "u-alice" } });
    await seedOnRoster("Alicia", "u-alice", 1);
    asUser("u-alice");

    expect((await leave("u-alice")).status).toBe(200);

    const remaining = await rosterNames();
    expect(remaining).not.toContain("Alicia"); // the row they were actually listed on
    expect(remaining).toContain("Bob");
  });

  it("the organizer declining a stranded guest is not a 404 (admin rsvp path)", async () => {
    // rsvp.ts hands the client-supplied id straight to archiveAndLeave, which used
    // to look it up as a Player row only — so a re-activated guest still 404'd.
    await seedOnRoster("Guest", null, 0);
    await seedOnRoster("Bob", "u-bob", 1);
    // The #1237 shape for a guest: the roster still lists them (GameParticipant is
    // active) while their legacy Player row is archived.
    await prisma.player.update({
      where: { id: await playerIdOf("Guest") },
      data: { archivedAt: new Date() },
    });

    asUser("u-owner");
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false } as any);
    const res = await rsvpRoute({
      params: { id: event.id, playerId: await eventPlayerIdOf("Guest") },
      request: req("http://x/rsvp", { method: "POST", body: JSON.stringify({ status: "no" }), userId: "u-owner" }),
    } as any);

    expect(res.status).toBe(200);
    expect(await rosterNames()).not.toContain("Guest");
  });

  it("declining a guest still soft-archives their legacy Player row", async () => {
    // The decline path identifies the roster row by name so it works without an
    // active Player row. It must still pass the row id when there is one: that is
    // what archiveAndLeave soft-archives, and an un-archived Player row keeps the
    // guest in the ADR 0017 player-only push tier — the exact mis-tiering #1237 is
    // about (main archives it, so this must not regress).
    await seedOnRoster("Guest", null, 0);
    await seedOnRoster("Bob", "u-bob", 1);
    asUser("u-owner");
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false } as any);

    const res = await rsvpRoute({
      params: { id: event.id, playerId: await eventPlayerIdOf("Guest") },
      request: req("http://x/rsvp", { method: "POST", body: JSON.stringify({ status: "no" }), userId: "u-owner" }),
    } as any);

    expect(res.status).toBe(200);
    const row = await prisma.player.findFirstOrThrow({ where: { eventId: event.id, name: "Guest" } });
    expect(row.archivedAt).toBeTruthy();
  });
});