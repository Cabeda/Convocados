/**
 * Roster change helpers — the repeated steps of re-adding a player to the
 * current Game. Extracted from the players route so the "queue semantics"
 * (a re-join goes to the end of the list) and the "re-join resets Attendance"
 * rule live in one place instead of three near-identical copies.
 */
import { prisma } from "./db.server";
import { nextGameParticipantOrder } from "./game.server";
import { activeParticipantsWhere } from "./activeParticipants.server";
import { upsertGameParticipantForRoster } from "./rosterCore.server";

/** Next free slot at the end of the active list (queue semantics). */
async function nextPlayerOrder(eventId: string): Promise<number> {
  const maxOrder = await prisma.player.aggregate({
    where: { eventId, archivedAt: null },
    _max: { order: true },
  });
  return (maxOrder._max.order ?? -1) + 1;
}

/**
 * Move an existing Player row to the end of the active list (queue semantics).
 * When `reactivate` is set the row is un-archived; when `linkUserId` is given
 * and the row has no account yet, the account is linked.
 */
export async function movePlayerToEndOfList(
  eventId: string,
  playerId: string,
  opts: { reactivate?: boolean; linkUserId?: string | null } = {},
): Promise<number> {
  const order = await nextPlayerOrder(eventId);
  await prisma.player.update({
    where: { id: playerId },
    data: {
      order,
      ...(opts.reactivate ? { archivedAt: null } : {}),
      ...(opts.linkUserId ? { userId: opts.linkUserId } : {}),
    },
  });
  return order;
}

/**
 * Ensure the player is on the current Game's active roster (un-archiving a
 * previously left GameParticipant) and reset their Attendance to "yes".
 */
export async function rejoinPlayerToCurrentGame(
  gameId: string,
  eventPlayerId: string,
): Promise<void> {
  const order = await nextGameParticipantOrder(gameId);
  await upsertGameParticipantForRoster({ gameId, eventPlayerId, status: "active", order });
  await prisma.rsvp.upsert({
    where: { eventPlayerId_gameId: { eventPlayerId, gameId } },
    create: { eventPlayerId, gameId, status: "yes", respondedAt: new Date() },
    update: { status: "yes", respondedAt: new Date() },
  });
}

/** Who a leave/remove request is about. Resolution is a pure read — it never writes. */
export interface LeaveTarget {
  /** Legacy Player row id when one exists (archived counts), else null when it
   *  needs repairPlayerRow. */
  playerId: string | null;
  /** The roster row that decides membership (ADR 0016). Set on the fallback path
   *  only — null when an un-archived Player row already answered the question. */
  eventPlayerId: string | null;
  /** Account behind this identity, when there is one. */
  userId: string | null;
}

/** How a caller says who is leaving: by account, by id, or by display name. */
export type LeaveSelector = { userId: string } | { playerId: string } | { name: string };

const EP_SELECT = { id: true, eventId: true, name: true, userId: true } as const;

async function currentGameOf(eventId: string): Promise<string | null> {
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  return event?.currentGameId ?? null;
}

/** Whether the current Game's active roster still lists this EventPlayer. */
async function isOnCurrentRoster(eventId: string, eventPlayerId: string): Promise<boolean> {
  const gameId = await currentGameOf(eventId);
  if (!gameId) return false;
  const participant = await prisma.gameParticipant.findFirst({
    where: { ...activeParticipantsWhere(gameId), eventPlayerId },
    select: { id: true },
  });
  return !!participant;
}

/**
 * EventPlayer rows matching `match`, preferring one the current roster lists.
 *
 * EventPlayer is unique on (eventId, name), *not* on userId, so one account can
 * own two rows — priority/confirm upserts by name using the caller's current
 * display name. An unordered findFirst can answer about the ghost and 404 the
 * player who is really there, which is the #1237 symptom all over again.
 */
async function rosteredEventPlayer(eventId: string, match: { userId?: string; name?: string }) {
  const where = { eventId, ...match };
  const gameId = await currentGameOf(eventId);
  if (gameId) {
    const participant = await prisma.gameParticipant.findFirst({
      where: { ...activeParticipantsWhere(gameId), eventPlayer: where },
      select: { eventPlayer: { select: EP_SELECT } },
    });
    if (participant) return participant.eventPlayer;
  }
  return prisma.eventPlayer.findFirst({ where, select: EP_SELECT });
}

/** Identify the roster row this request is about, from an account, an id or a name. */
async function eventPlayerFor(eventId: string, opts: LeaveSelector) {
  if ("userId" in opts) return rosteredEventPlayer(eventId, { userId: opts.userId });
  if ("name" in opts) return rosteredEventPlayer(eventId, { name: opts.name });
  // The event GET hands out EventPlayer ids (ADR 0016), so that is the common case.
  const byId = await prisma.eventPlayer.findFirst({
    where: { id: opts.playerId, eventId },
    select: EP_SELECT,
  });
  if (byId) return byId;
  // Older clients send a legacy Player row id; match its name to the roster.
  const row = await prisma.player.findFirst({ where: { id: opts.playerId, eventId }, select: { name: true } });
  return row ? rosteredEventPlayer(eventId, { name: row.name }) : null;
}

/**
 * Restore the legacy Player row for someone the roster still lists (#1237).
 *
 * This WRITES — it un-archives an existing row, or creates one — so it must only
 * be called once the request is authorized. `resolveLeaveTarget` stays read-only
 * for exactly that reason: a rejected leave must not mutate state.
 *
 * Returns null when the row belongs to a different account — never hijack it.
 */
export async function repairPlayerRow(eventPlayerId: string): Promise<string | null> {
  const ep = await prisma.eventPlayer.findUnique({ where: { id: eventPlayerId }, select: EP_SELECT });
  if (!ep) return null;

  const existing = await prisma.player.findUnique({
    where: { eventId_name: { eventId: ep.eventId, name: ep.name } },
    select: { id: true, userId: true, archivedAt: true },
  });
  if (existing) {
    if (existing.userId && existing.userId !== ep.userId) return null;
    if (!existing.archivedAt) return existing.id;
    // Un-archiving in place keeps the row's stale `order`, dropping it on top of a
    // live player's slot; every other re-join goes to the end (#1237).
    await movePlayerToEndOfList(ep.eventId, existing.id, {
      reactivate: true,
      ...(existing.userId ? {} : { linkUserId: ep.userId }),
    });
    return existing.id;
  }
  // Upsert, not find-then-create: two taps on Leave race on the unique
  // (eventId, name) key, and the loser would throw P2002 out of the route as a
  // 500 instead of leaving.
  const created = await prisma.player.upsert({
    where: { eventId_name: { eventId: ep.eventId, name: ep.name } },
    create: { eventId: ep.eventId, name: ep.name, userId: ep.userId, order: await nextPlayerOrder(ep.eventId) },
    update: {},
  });
  return created.id;
}

/**
 * Resolve who a leave/remove request is about, so that anyone the event page
 * still lists can actually leave it (#1237).
 *
 * Roster membership is decided by GameParticipant (ADR 0016), but every leave and
 * remove path identifies a player by their legacy Player row. The reactivation
 * paths — accepting a re-invite, confirming a priority spot — put someone back on
 * the roster without clearing Player.archivedAt, or without a Player row at all.
 * The result was #1237: you appear on the list, and both the Leave button and the
 * x answer "you are not a player in this event", leaving no way off the list.
 *
 * Take the un-archived row when there is one; otherwise fall back to the
 * authoritative roster. Returns null only when the player is genuinely off the
 * roster, so callers can still 404 someone who has really already left.
 *
 * Answering "who" and repairing the row are deliberately separate steps: this one
 * only reads, and archiveAndLeave heals with repairPlayerRow once the route has
 * authorized the request. Doing both here would mean a request rejected with 403
 * had already flipped Player.archivedAt, which changes ADR 0017 notification
 * tiering and suppresses re-invite reactivation for someone who never left.
 */
export async function resolveLeaveTarget(
  eventId: string,
  opts: LeaveSelector,
): Promise<LeaveTarget | null> {
  // Fast path: an un-archived Player row is the historical gate, and still the
  // only membership signal on an event with no current Game.
  if ("userId" in opts) {
    const row = await prisma.player.findFirst({
      where: { eventId, userId: opts.userId, archivedAt: null },
      select: { id: true, userId: true },
    });
    if (row) return { playerId: row.id, eventPlayerId: null, userId: opts.userId };
  } else if ("playerId" in opts) {
    const row = await prisma.player.findFirst({
      where: { id: opts.playerId, eventId, archivedAt: null },
      select: { id: true, userId: true },
    });
    if (row) return { playerId: row.id, eventPlayerId: null, userId: row.userId };
  } else {
    const row = await prisma.player.findFirst({
      where: { eventId, name: opts.name, archivedAt: null },
      select: { id: true, userId: true },
    });
    if (row) return { playerId: row.id, eventPlayerId: null, userId: row.userId };
  }

  // Slow path: the Player row is archived or absent, but the roster may still
  // list this player. Identify them from the roster and confirm membership.
  const eventPlayer = await eventPlayerFor(eventId, opts);
  if (!eventPlayer) return null;
  if (!(await isOnCurrentRoster(eventId, eventPlayer.id))) return null;

  const row = await prisma.player.findUnique({
    where: { eventId_name: { eventId, name: eventPlayer.name } },
    select: { id: true, userId: true },
  });
  return {
    playerId: row?.id ?? null,
    eventPlayerId: eventPlayer.id,
    // The roster row is the identity going forward; the legacy row only wins when
    // it actually carries an account, so the protected-player gate keeps judging
    // the same person it did before.
    userId: row?.userId ?? eventPlayer.userId,
  };
}
