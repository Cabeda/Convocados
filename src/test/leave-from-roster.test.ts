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

import { getSession } from "~/lib/auth.helpers.server";
import { POST as leaveRoute } from "~/pages/api/events/[id]/leave";
import { DELETE as playersDelete } from "~/pages/api/events/[id]/players";
import { POST as rosterRoute } from "~/pages/api/events/[id]/roster";
import { POST as priorityConfirm } from "~/pages/api/events/[id]/priority/confirm";
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
async function seedOnRoster(name: string, userId: string, order: number) {
  await prisma.player.create({ data: { eventId: event.id, name, userId, order } });
  const eventPlayer = await prisma.eventPlayer.create({ data: { eventId: event.id, name, userId } });
  await prisma.gameParticipant.create({ data: { gameId: event.currentGameId, eventPlayerId: eventPlayer.id, order } });
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
    expect((await leave("u-alice")).status).toBe(404);
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