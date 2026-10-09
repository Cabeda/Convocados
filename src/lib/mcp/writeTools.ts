import { prisma } from "../db.server";
import type { AuthContext } from "../authenticate.server";
import type { ToolDef } from "./tools";
import { McpError } from "./errors";
import { resolveRosterTarget, upsertEventPlayerForRoster, upsertGameParticipantForRoster } from "../rosterCore.server";
import { getActiveRosterState } from "../roster.server";
import { syncGamePayments } from "../settlement.server";
import { addPlayerToTeams, validateTeams } from "../teamFormation.server";
import { archiveAndLeave } from "../leave.server";
import { Randomize } from "../random";
import type { Imatch } from "../random";
import { balanceTeams, processGame } from "../elo.server";
import { applyFormationLayout } from "../teams";
import { recordReceived } from "../payments.server";
import { isGameEnded } from "../gameStatus";
import { serializeRecurrenceRule, type RecurrenceRule } from "../recurrence";
import { getDefaultDurationMinutes } from "../sports";
import { scheduleEventReminders, cancelEventJobs } from "../scheduler.server";
import { fromDateTimeLocalValue } from "../timezones";
import { cancelCurrentGame, CancelError } from "../cancelEvent.server";
import { upsertRsvp } from "../rsvp.server";
import { enqueueRsvpAnswerNotification } from "../rsvp-notifications.server";
import { enqueuePushSetupHintSafe } from "../pushSetupHint";
import { getNotificationPrefs } from "../notificationPrefs.server";
import { sendPushToUser } from "../push.server";
import { logEvent } from "../eventLog.server";
import { assignTeams } from "../teamAssignment.server";
import { setEventCost } from "../eventCost.server";
import { claimPlayer as claimPlayerFn } from "../claimPlayer.server";

/**
 * MCP write tools (V1.5). All mutations reuse the same server-side libs as
 * the REST API routes so behavior (rosterCore, archiveAndLeave, ELO, ledger)
 * stays identical. Every event-scoped mutation is gated on the actor being
 * the event owner or an admin — an OAuth token alone is never enough to mutate
 * an event the user does not run.
 */

/**
 * Fire-and-forget a side effect (audit log, push, streak counter) without ever
 * failing the tool call. One helper rather than an inline `.catch(() => {})` per
 * call site: identical behaviour, and a single failure path to test.
 */
function bestEffort(work: Promise<unknown>): Promise<unknown> {
  return work.catch(() => {});
}

const VALID_PAYMENT_STATUSES = ["pending", "sent", "paid"] as const;
const VALID_RECURRENCE_FREQS = ["daily", "weekly", "monthly", "yearly"] as const;

/** Fetch the event and verify the actor owns it or is an event admin. */
async function requireEventAccess(ctx: AuthContext, eventId: string) {
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new McpError("Game not found", -32001, 404);
  if (event.ownerId !== ctx.userId) {
    const isAdmin = await prisma.eventAdmin.count({ where: { eventId, userId: ctx.userId } });
    if (isAdmin === 0) {
      throw new McpError("Forbidden: you must be the owner or an admin of this event", -32001, 403);
    }
  }
  return event;
}

async function addPlayer(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const event = await requireEventAccess(ctx, eventId);
  if (!event.currentGameId) throw new McpError("This event has no current game.", -32001, 400);
  if (isGameEnded(event.dateTime, event.durationMinutes)) {
    throw new McpError("The game has already ended — players can no longer be added.", -32001, 403);
  }

  let target: Awaited<ReturnType<typeof resolveRosterTarget>>;
  try {
    target = await resolveRosterTarget({
      name: typeof args.name === "string" ? args.name : null,
      email: typeof args.email === "string" ? args.email : null,
      userId: typeof args.userId === "string" ? args.userId : null,
    });
  } catch (e) {
    throw new McpError(e instanceof Error ? e.message : "Player name is required.", -32602, 400);
  }

  const roster = await getActiveRosterState(eventId, event.maxPlayers, event.currentGameId);
  if (roster.totalCount >= event.maxPlayers * 2) {
    throw new McpError(`The bench is full (maximum ${event.maxPlayers} bench players).`, -32001, 400);
  }

  const ep = await upsertEventPlayerForRoster(eventId, target);
  await upsertGameParticipantForRoster({ gameId: event.currentGameId, eventPlayerId: ep.id, status: "active" });
  await prisma.player.upsert({
    where: { eventId_name: { eventId, name: target.name } },
    create: { eventId, name: target.name, userId: target.userId, order: roster.totalCount },
    update: { userId: target.userId ?? undefined, archivedAt: null },
  });
  await syncGamePayments(event.currentGameId, eventId);

  const isActive = roster.activeCount < event.maxPlayers;
  if (isActive) {
    await addPlayerToTeams(eventId, target.name, event.currentGameId);
    await validateTeams(eventId, event.maxPlayers, event.currentGameId);
  }

  // Auto-follow + ELO seat — same side effects as POST /players.
  if (target.userId) {
    await prisma.eventFollow.upsert({
      where: { eventId_userId: { eventId, userId: target.userId } },
      create: { eventId, userId: target.userId },
      update: {},
    });
  }
  await prisma.playerRating.upsert({
    where: { eventId_name: { eventId, name: target.name } },
    create: { eventId, name: target.name, rating: 1000 },
    update: {},
  });

  return { ok: true, name: target.name, userId: target.userId, isActive };
}

async function removePlayer(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  await requireEventAccess(ctx, eventId);

  const byId = (args.playerId as string | undefined) ?? undefined;
  const byName = typeof args.name === "string" ? args.name.trim() : undefined;
  if (!byId && !byName) throw new McpError("playerId or name required", -32602, 400);

  // ADR 0016: the event GET hands out EventPlayer ids, and archiveAndLeave
  // identifies by roster name, so resolve one to the other here. One read, no
  // archivedAt filtering: that filter is what made a re-activated player
  // un-removable from here (#1237).
  const ep = byId
    ? await prisma.eventPlayer.findFirst({ where: { id: byId, eventId }, select: { name: true } })
    : null;
  const row = await prisma.player.findFirst({
    where: byId && !ep ? { id: byId, eventId } : { eventId, name: ep?.name ?? byName },
    select: { id: true, name: true },
  });
  const name = row?.name ?? ep?.name;
  if (!name) throw new McpError("Player not found.", -32001, 404);

  const result = await archiveAndLeave({
    eventId,
    playerId: row?.id ?? null,
    name,
    actor: { kind: "organizer", userId: ctx.userId },
  });
  return { ok: true, name: result.undo.name, warned: result.warned, benchEmptyAfter: result.benchEmptyAfter };
}

async function randomizeTeams(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const event = await requireEventAccess(ctx, eventId);

  let allPlayers: { name: string; order: number }[];
  if (event.currentGameId) {
    const participants = await prisma.gameParticipant.findMany({
      where: { gameId: event.currentGameId, archivedAt: null, status: { not: "pending" } },
      include: { eventPlayer: { select: { name: true } } },
      orderBy: { order: "asc" },
    });
    allPlayers = participants.map((gp) => ({ name: gp.eventPlayer.name, order: gp.order }));
  } else {
    const rows = await prisma.player.findMany({ where: { eventId, archivedAt: null }, orderBy: { order: "asc" } });
    allPlayers = rows.map((p) => ({ name: p.name, order: p.order }));
  }

  const players = allPlayers.slice(0, event.maxPlayers);
  if (players.length < 2) throw new McpError("Need at least 2 players.", -32001, 400);

  const balanced = args.balanced === true;
  let matches: Imatch[];
  if (balanced) {
    const ratings = await prisma.playerRating.findMany({ where: { eventId } });
    const ratingMap = new Map(ratings.map((r) => [r.name, r.rating]));
    matches = balanceTeams(
      players.map((p) => ({ name: p.name, rating: ratingMap.get(p.name) ?? 1000 })),
      [event.teamOneName, event.teamTwoName],
    );
  } else {
    matches = Randomize(players.map((p) => p.name), [event.teamOneName, event.teamTwoName]);
  }

  // Same layout as POST /randomize: resolve each team's formation against the
  // sport and place every member on a slot before storing, so an agent-drawn
  // write is indistinguishable from an organiser-drawn one (#1286).
  const laidOut = applyFormationLayout(matches, event.sport);

  await prisma.$transaction([
    prisma.teamResult.deleteMany({ where: { eventId } }),
    ...laidOut.map((match) =>
      prisma.teamResult.create({
        data: {
          name: match.team,
          formation: match.formation ?? null,
          eventId,
          members: { create: match.players.map((p) => ({ name: p.name, order: p.order, slot: p.slot ?? null })) },
        },
      })
    ),
  ]);

  return {
    ok: true,
    balanced,
    teams: matches.map((m) => ({ name: m.team, players: m.players.map((p) => p.name) })),
  };
}

async function updatePayment(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  const playerName = args.playerName as string | undefined;
  const status = args.status as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  if (!playerName) throw new McpError("playerName required", -32602, 400);
  if (!status || !(VALID_PAYMENT_STATUSES as readonly string[]).includes(status)) {
    throw new McpError(`Invalid status. Must be one of: ${VALID_PAYMENT_STATUSES.join(", ")}`, -32602, 400);
  }

  await requireEventAccess(ctx, eventId);
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (!event?.currentGameId) throw new McpError("No cost set for this event.", -32001, 404);
  const eventPlayer = await prisma.eventPlayer.findUnique({
    where: { eventId_name: { eventId, name: playerName } },
    select: { id: true },
  });
  if (!eventPlayer) throw new McpError("Player payment not found.", -32001, 404);
  // ADR 0016: the current Game's GamePayment roll replaces the legacy
  // EventCost/PlayerPayment row.
  const payment = await prisma.gamePayment.findUnique({
    where: { gameId_eventPlayerId: { gameId: event.currentGameId, eventPlayerId: eventPlayer.id } },
  });
  if (!payment) throw new McpError("Player payment not found.", -32001, 404);

  const method =
    args.method === undefined ? undefined : args.method === null ? null : String(args.method).trim().slice(0, 50) || null;

  const updated = await prisma.gamePayment.update({
    where: { id: payment.id },
    data: { status, paidAt: status === "paid" ? new Date() : null, markedBy: ctx.userId, ...(method !== undefined && { method }) },
  });

  if (status === "paid") {
    await recordReceived({ eventId, playerName, markedById: ctx.userId, amount: updated.amount });
  }

  return {
    ...updated,
    paidAt: updated.paidAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  };
}

async function setScore(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  const scoreOneRaw = args.scoreOne;
  const scoreTwoRaw = args.scoreTwo;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  if (scoreOneRaw === undefined || scoreTwoRaw === undefined) {
    throw new McpError("scoreOne and scoreTwo are required", -32602, 400);
  }
  const scoreOne = Number(scoreOneRaw);
  const scoreTwo = Number(scoreTwoRaw);
  if (!Number.isInteger(scoreOne) || !Number.isInteger(scoreTwo) || scoreOne < 0 || scoreTwo < 0) {
    throw new McpError("scoreOne and scoreTwo must be non-negative integers", -32602, 400);
  }

  await requireEventAccess(ctx, eventId);
  const latest = await prisma.gameHistory.findFirst({ where: { eventId }, orderBy: { dateTime: "desc" }, take: 1 });
  if (!latest) throw new McpError("No game history yet for this event.", -32001, 404);

  const updated = await prisma.gameHistory.update({
    where: { id: latest.id },
    data: { scoreOne, scoreTwo },
  });

  if (updated.status === "played" && updated.teamsSnapshot && !updated.eloProcessed) {
    try {
      await processGame(eventId, updated.id, JSON.parse(updated.teamsSnapshot), scoreOne, scoreTwo);
    } catch {
      // ELO processing is best-effort — never fail the score save for it.
    }
  }

  return {
    id: updated.id,
    eventId,
    scoreOne: updated.scoreOne,
    scoreTwo: updated.scoreTwo,
    dateTime: updated.dateTime.toISOString(),
  };
}

async function createEvent(args: Record<string, unknown>, ctx: AuthContext) {
  const title = String(args.title ?? "").trim().slice(0, 100);
  const location = String(args.location ?? "").trim().slice(0, 200);
  const dateTimeRaw = String(args.dateTime ?? "");
  const timezoneRaw = String(args.timezone ?? "UTC").trim().slice(0, 100);
  const teamOneName = String(args.teamOneName ?? "Ninjas").trim().slice(0, 50) || "Ninjas";
  const teamTwoName = String(args.teamTwoName ?? "Gunas").trim().slice(0, 50) || "Gunas";
  const maxPlayersRaw = parseInt(String(args.maxPlayers ?? "10"), 10);
  const maxPlayers = isNaN(maxPlayersRaw) || maxPlayersRaw < 2 ? 10 : Math.min(maxPlayersRaw, 100);
  const sport = String(args.sport ?? "football-5v5").trim().slice(0, 50) || "football-5v5";
  // Same discoverability default as POST /api/events: authenticated creators
  // get a public (discoverable) game unless they explicitly opt out.
  const isPublic =
    args.isPublic === undefined || args.isPublic === null ? true : Boolean(args.isPublic);
  const isRecurring = Boolean(args.isRecurring);

  if (!title) throw new McpError("Title is required.", -32602, 400);
  if (!dateTimeRaw) throw new McpError("Date and time are required.", -32602, 400);

  let timezone = "UTC";
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezoneRaw });
    timezone = timezoneRaw;
  } catch {
    // fall back to UTC silently
  }

  let dateTime: Date;
  const looksLikeUtc = /[Zz]$/.test(dateTimeRaw) || /[+-]\d{2}:\d{2}$/.test(dateTimeRaw);
  if (!looksLikeUtc && timezone !== "UTC") {
    dateTime = new Date(fromDateTimeLocalValue(dateTimeRaw, timezone));
  } else {
    dateTime = new Date(dateTimeRaw);
  }
  if (isNaN(dateTime.getTime())) throw new McpError("Invalid date/time.", -32602, 400);
  if (dateTime < new Date()) throw new McpError("Event must be in the future.", -32602, 400);

  let recurrenceRule: string | null = null;
  let nextResetAt: Date | null = null;
  const durationMinutes = getDefaultDurationMinutes(sport);
  if (isRecurring) {
    const rawFreq = args.recurrenceFreq;
    const freq = rawFreq && (VALID_RECURRENCE_FREQS as readonly string[]).includes(rawFreq as string) ? (rawFreq as string) : null;
    if (freq) {
      const rule: RecurrenceRule = {
        freq: freq as RecurrenceRule["freq"],
        interval: isNaN(parseInt(String(args.recurrenceInterval ?? "1"), 10)) ? 1 : Math.max(1, parseInt(String(args.recurrenceInterval ?? "1"), 10)),
        ...(typeof args.recurrenceByDay === "string" ? { byDay: args.recurrenceByDay } : {}),
      };
      recurrenceRule = serializeRecurrenceRule(rule);
      nextResetAt = new Date(dateTime.getTime() + durationMinutes * 60 * 1000);
    }
  }

  // No geocoding for MCP-created events — coordinates are optional and the
  // free-text path would make an external network call per creation.
  const event = await prisma.event.create({
    data: {
      title,
      location,
      dateTime,
      timezone,
      maxPlayers,
      teamOneName,
      teamTwoName,
      sport,
      isPublic,
      isRecurring,
      recurrenceRule,
      nextResetAt,
      durationMinutes,
      ownerId: ctx.userId,
    },
  });

  const game = await prisma.game.create({ data: { eventId: event.id, dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

  try {
    await scheduleEventReminders(event.id, event.dateTime, event.durationMinutes);
  } catch {
    // Scheduling is best-effort — event creation must never fail because of it.
  }

  return { id: event.id, title: event.title, dateTime: event.dateTime.toISOString() };
}

/** Update editable Event settings. Only provided fields change. Owner/admin only. */
async function updateEvent(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  await requireEventAccess(ctx, eventId);

  const data: {
    title?: string;
    location?: string;
    sport?: string;
    maxPlayers?: number;
    isPublic?: boolean;
    timezone?: string;
    dateTime?: Date;
  } = {};

  if (args.title !== undefined) {
    const title = String(args.title).trim().slice(0, 100);
    if (!title) throw new McpError("title cannot be empty", -32602, 400);
    data.title = title;
  }
  if (args.location !== undefined) {
    data.location = String(args.location).trim().slice(0, 200);
  }
  if (args.sport !== undefined) {
    const sport = String(args.sport).trim().slice(0, 50);
    if (!sport) throw new McpError("sport cannot be empty", -32602, 400);
    data.sport = sport;
  }
  if (args.maxPlayers !== undefined) {
    const maxPlayers = Math.trunc(Number(args.maxPlayers));
    if (!Number.isFinite(maxPlayers) || maxPlayers < 2 || maxPlayers > 100) {
      throw new McpError("maxPlayers must be between 2 and 100", -32602, 400);
    }
    data.maxPlayers = maxPlayers;
  }
  if (args.isPublic !== undefined) {
    data.isPublic = Boolean(args.isPublic);
  }
  if (args.timezone !== undefined) {
    const timezone = String(args.timezone).trim().slice(0, 100);
    try {
      Intl.DateTimeFormat(undefined, { timeZone: timezone });
    } catch {
      throw new McpError("Invalid timezone", -32602, 400);
    }
    data.timezone = timezone;
  }
  if (args.dateTime !== undefined) {
    const dateTime = new Date(String(args.dateTime));
    if (isNaN(dateTime.getTime())) throw new McpError("Invalid dateTime", -32602, 400);
    if (dateTime.getTime() <= Date.now()) throw new McpError("dateTime must be in the future", -32602, 400);
    data.dateTime = dateTime;
  }

  if (Object.keys(data).length === 0) {
    throw new McpError("No fields to update — provide at least one of title, location, dateTime, timezone, sport, maxPlayers, isPublic", -32602, 400);
  }

  await prisma.event.update({ where: { id: eventId }, data });

  if (data.dateTime) {
    const updated = await prisma.event.findUnique({ where: { id: eventId } });
    if (updated) {
      await bestEffort(cancelEventJobs(eventId));
      try {
        await scheduleEventReminders(eventId, updated.dateTime, updated.durationMinutes);
      } catch {
        // best-effort rescheduling
      }
    }
  }

  bestEffort(logEvent(eventId, "event_updated", null, ctx.userId, {
    fields: Object.keys(data),
    source: "mcp",
  }));

  return { id: eventId, updated: Object.keys(data) };
}

/** Cancel the current Game of an Event. Owner/admin only. */
async function cancelEvent(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  await requireEventAccess(ctx, eventId);
  try {
    const result = await cancelCurrentGame(eventId, { id: ctx.userId, name: null });
    return { ok: true, eventId, gameId: result.gameId };
  } catch (err) {
    if (err instanceof CancelError) throw new McpError(err.message, -32001, err.status);
    throw err;
  }
}

/** Set the caller's RSVP (yes/no/maybe) for a Game. Self-service; any authenticated user. */
async function rsvp(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const status = String(args.status ?? "");
  if (!["yes", "no", "maybe"].includes(status)) {
    throw new McpError("status must be 'yes', 'no', or 'maybe'", -32602, 400);
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, dateTime: true, title: true },
  });
  if (!event) throw new McpError("Game not found", -32001, 404);
  if (event.dateTime.getTime() <= Date.now()) {
    throw new McpError("The game has already started.", -32001, 409);
  }

  const typedStatus = status as "yes" | "no" | "maybe";
  const result = await upsertRsvp(eventId, ctx.userId, typedStatus);

  bestEffort(enqueueRsvpAnswerNotification({
    eventId,
    eventTitle: event.title,
    status: typedStatus,
    actorUserId: ctx.userId,
    actorName: null,
    actorIsLogged: true,
  }));

  bestEffort(logEvent(
    eventId,
    typedStatus === "yes" ? "rsvp_yes" : typedStatus === "no" ? "rsvp_no" : "rsvp_maybe",
    null,
    ctx.userId,
    { source: "mcp", status: typedStatus },
  ));

  return { ok: true, status: result.status, respondedAt: result.respondedAt };
}

/**
 * Follow an event the caller does not play in. Self-service.
 *
 * Mirrors POST /api/events/[id]/follow. Being on the roster already implies
 * following (ADR 0017), so this is for spectators who want event-change and
 * recruitment notifications without a roster slot.
 */
async function followEvent(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw new McpError("Game not found", -32001, 404);

  const follow = await prisma.eventFollow.upsert({
    where: { eventId_userId: { eventId, userId: ctx.userId } },
    create: { eventId, userId: ctx.userId },
    update: {},
  });

  // First-time follow nudge to enable device push (7-day per-user cooldown).
  enqueuePushSetupHintSafe(ctx.userId, eventId);

  return {
    ok: true,
    following: true,
    mutePlayerActivity: follow.mutePlayerActivity,
    muteReminders: follow.muteReminders,
    mutePostGame: follow.mutePostGame,
    muteEventDetails: follow.muteEventDetails,
  };
}

/**
 * Unfollow an event. Self-service.
 *
 * ADR 0003: a player who joins but later unfollows keeps their roster slot and
 * merely opts out of notifications, so this is not blocked for players.
 */
async function unfollowEvent(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  await prisma.eventFollow.deleteMany({ where: { eventId, userId: ctx.userId } });
  return { ok: true, following: false };
}

/**
 * Leave an event the caller is a player in. Self-service — resolves the
 * caller's own roster row, so this can never remove anybody else.
 */
async function leaveEvent(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  await requireEventAccess(ctx, eventId);

  const player = await prisma.player.findFirst({
    where: { eventId, userId: ctx.userId, archivedAt: null },
    select: { id: true },
  });
  // ADR 0026: guest invite rows and display-name changes can leave an
  // EventPlayer-native identity with no live Player row at all.
  const eventPlayer = player
    ? null
    : await prisma.eventPlayer.findFirst({
        where: { eventId, userId: ctx.userId },
        select: { name: true },
      });
  if (!player && !eventPlayer) {
    throw new McpError("You are not a player in this event.", -32001, 404);
  }

  const result = await archiveAndLeave({
    eventId,
    playerId: player?.id ?? null,
    ...(eventPlayer ? { name: eventPlayer.name } : {}),
    actor: { kind: "self", userId: ctx.userId },
  });

  return {
    ok: true,
    name: result.undo.name,
    warned: result.warned,
    benchEmptyAfter: result.benchEmptyAfter,
  };
}

/**
 * Mark or unmark a participant as a no-show for one game. Owner/admin only.
 * Mirrors POST /api/events/[id]/no-show (ADR 0018).
 */
async function setNoShow(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const event = await requireEventAccess(ctx, eventId);

  const gameId = args.gameId as string | undefined;
  const eventPlayerId = args.eventPlayerId as string | undefined;
  const noShow = args.noShow;
  if (!gameId || !eventPlayerId || typeof noShow !== "boolean") {
    throw new McpError("gameId, eventPlayerId and noShow (boolean) are required.", -32602, 400);
  }

  // Bind the supplied game to THIS event, otherwise owning event A would grant
  // no-show writes on a game belonging to event B.
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { eventId: true } });
  if (!game || game.eventId !== eventId) {
    throw new McpError("gameId does not belong to this event.", -32602, 400);
  }

  const participant = await prisma.gameParticipant.findUnique({
    where: { gameId_eventPlayerId: { gameId, eventPlayerId } },
    include: { eventPlayer: { select: { userId: true } } },
  });
  if (!participant) throw new McpError("Participant not found.", -32001, 404);

  await prisma.gameParticipant.update({ where: { id: participant.id }, data: { noShow } });

  const userId = participant.eventPlayer.userId;
  if (userId) {
    if (noShow) {
      await bestEffort(prisma.priorityEnrollment.updateMany({
        where: { eventId, userId },
        data: { noShowStreak: { increment: 1 } },
      }));
      await bestEffort(enqueueNoShowNotification({
        userId,
        eventId,
        title: event.title,
        streak: await noShowStreak(eventId, userId),
      }));
    } else {
      await bestEffort(prisma.priorityEnrollment.updateMany({
        where: { eventId, userId, noShowStreak: { gt: 0 } },
        data: { noShowStreak: { decrement: 1 } },
      }));
    }
  }

  // No event-log entry: EventAction has no no-show verb and the REST route
  // logs nothing either. GameParticipant.noShow plus the streak is the record.
  return { ok: true, noShow };
}

async function noShowStreak(eventId: string, userId: string): Promise<number> {
  const enrollment = await prisma.priorityEnrollment.findUnique({
    where: { eventId_userId: { eventId, userId } },
    select: { noShowStreak: true },
  });
  return enrollment?.noShowStreak ?? 1;
}

/** Best-effort push telling the player they were marked absent. */
async function enqueueNoShowNotification(input: {
  userId: string;
  eventId: string;
  title: string;
  streak: number;
}): Promise<void> {
  const prefs = await getNotificationPrefs(input.userId);
  if (!prefs.pushEnabled) return;
  const body =
    `You missed ${input.title}. No-show streak: ${input.streak}.` +
    (input.streak >= 2 ? " Priority may be affected." : "");
  await bestEffort(sendPushToUser(input.userId, input.title, body, `/events/${input.eventId}`));
}

async function setTeams(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const event = await requireEventAccess(ctx, eventId);

  const teamOnePlayerIds = args.teamOnePlayerIds;
  const teamTwoPlayerIds = args.teamTwoPlayerIds;
  if (!Array.isArray(teamOnePlayerIds) || !Array.isArray(teamTwoPlayerIds)) {
    throw new McpError("teamOnePlayerIds and teamTwoPlayerIds must be arrays", -32602, 400);
  }

  try {
    const result = await assignTeams(
      eventId,
      { teamOnePlayerIds, teamTwoPlayerIds },
      event.maxPlayers,
      event.currentGameId,
      event.sport,
    );
    return {
      ok: true,
      teamOne: { name: result.teamOne.name, players: result.teamOne.members.map((m) => m.name) },
      teamTwo: { name: result.teamTwo.name, players: result.teamTwo.members.map((m) => m.name) },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("not found") || message.includes("Duplicate") || message.includes("bench")) {
      throw new McpError(message, -32602, 400);
    }
    throw err;
  }
}

async function setCost(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  await requireEventAccess(ctx, eventId);

  const totalAmount = Number(args.totalAmount);
  if (!totalAmount || totalAmount <= 0) {
    throw new McpError("totalAmount must be a positive number.", -32602, 400);
  }

  try {
    const result = await setEventCost(eventId, args as any);
    return {
      ok: true,
      totalAmount: result.totalAmount,
      currency: result.currency,
      scope: result.scope,
      paymentCount: result.payments.length,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message.includes("totalAmount") || message.includes("monthly") || message.includes("dropIn") || message.includes("payment method") || message.includes("No active game")) {
      throw new McpError(message, -32602, 400);
    }
    throw err;
  }
}

async function claimPlayer(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string | undefined;
  const playerId = args.playerId as string | undefined;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  if (!playerId) throw new McpError("playerId required", -32602, 400);

  const user = await prisma.user.findUnique({
    where: { id: ctx.userId },
    select: { name: true },
  });
  if (!user) throw new McpError("User not found", -32001, 404);

  try {
    const result = await claimPlayerFn(eventId, {
      playerId,
      userId: ctx.userId,
      userName: user.name,
    });
    return result;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    if (message === "Player not found.") {
      throw new McpError(message, -32001, 404);
    }
    if (message.includes("already linked") || message.includes("already have") || message.includes("already claimed")) {
      throw new McpError(message, -32001, 409);
    }
    throw err;
  }
}

export const WRITE_TOOLS: ToolDef[] = [
  {
    name: "convocados_add_player",
    description: "Add a player to a Game's active roster (by name, email or userId). Actor must own or admin the event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        name: { type: "string", description: "Player display name (used when email/userId do not resolve)" },
        email: { type: "string", description: "Registered user email (resolves to their account)" },
        userId: { type: "string", description: "Registered user id" },
      },
      required: ["eventId"],
    },
    scope: "manage:players",
    handler: addPlayer,
  },
  {
    name: "convocados_remove_player",
    description: "Remove a player from a Game (soft-archive, triggers leave side-effects). Provide playerId or name. Actor must own or admin the event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        playerId: { type: "string", description: "Player row id (or EventPlayer id)" },
        name: { type: "string", description: "Player display name (alternative to playerId)" },
      },
      required: ["eventId"],
    },
    scope: "manage:players",
    handler: removePlayer,
  },
  {
    name: "convocados_randomize_teams",
    description: "Generate/randomize teams for a Game from its active players, overwriting any existing assignment. Set balanced=true to use ELO balancing. Actor must own or admin the event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        balanced: { type: "boolean", description: "Balance teams by ELO rating (default false)" },
      },
      required: ["eventId"],
    },
    scope: "manage:teams",
    handler: randomizeTeams,
  },
  {
    name: "convocados_update_payment",
    description: "Update a player's payment status (pending|sent|paid) for a Game. paid writes the wallet ledger credit. Actor must own or admin the event, unless marking their own payment as sent.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        playerName: { type: "string", description: "Player display name" },
        status: { type: "string", enum: ["pending", "sent", "paid"], description: "pending = unpaid, sent = player says they paid, paid = organizer confirmed" },
        method: { type: "string", description: "Payment method label (mbway, revolut, cash, ...)" },
      },
      required: ["eventId", "playerName", "status"],
    },
    scope: "manage:payments",
    handler: updatePayment,
  },
  {
    name: "convocados_set_score",
    description: "Set the final score (scoreOne, scoreTwo) on the latest GameHistory for an Event. Triggers ELO processing. Actor must own or admin the event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        scoreOne: { type: "integer", description: "Team one score" },
        scoreTwo: { type: "integer", description: "Team two score" },
      },
      required: ["eventId", "scoreOne", "scoreTwo"],
    },
    scope: "write:events",
    handler: setScore,
  },
  {
    name: "convocados_create_event",
    description: "Create a new Game (Event) owned by the caller with its first Game instance. Location is stored as text (no geocoding).",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Event title" },
        dateTime: { type: "string", description: "ISO 8601 datetime, must be in the future" },
        location: { type: "string", description: "Location text" },
        timezone: { type: "string", description: "IANA timezone (default UTC)" },
        maxPlayers: { type: "integer", description: "Players per game (default 10)" },
        sport: { type: "string", description: "Sport id (default football-5v5)" },
        teamOneName: { type: "string", description: "Team one name (default Ninjas)" },
        teamTwoName: { type: "string", description: "Team two name (default Gunas)" },
        isPublic: { type: "boolean", description: "Public listing (default false)" },
        isRecurring: { type: "boolean", description: "Recurring event (default false)" },
        recurrenceFreq: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"], description: "Recurrence period (only used when isRecurring is true)" },
        recurrenceInterval: { type: "integer", description: "Repeat every N periods (default 1)" },
        recurrenceByDay: { type: "string", description: "Weekday code for weekly recurrence, e.g. MO" },
      },
      required: ["title", "dateTime"],
    },
    scope: "create:events",
    handler: createEvent,
  },
  {
    name: "convocados_update_event",
    description: "Update Event settings (title, location, dateTime, timezone, sport, maxPlayers, isPublic). Only provided fields change. Actor must own or admin the event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        title: { type: "string", description: "New title" },
        location: { type: "string", description: "New location text" },
        dateTime: { type: "string", description: "New ISO 8601 datetime, must be in the future" },
        timezone: { type: "string", description: "IANA timezone" },
        sport: { type: "string", description: "Sport id" },
        maxPlayers: { type: "integer", description: "Players per game (2-100)" },
        isPublic: { type: "boolean", description: "Public listing flag" },
      },
      required: ["eventId"],
    },
    scope: "write:events",
    handler: updateEvent,
  },
  {
    name: "convocados_cancel_event",
    description: "Cancel the current Game of an Event (reverses payments, snapshots history, advances recurring events). Actor must own or admin the event.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string", description: "Event ID" } },
      required: ["eventId"],
    },
    scope: "write:events",
    handler: cancelEvent,
  },
  {
    name: "convocados_rsvp",
    description: "Set YOUR RSVP for a Game to yes, no, or maybe. Self-service for any authenticated user.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        status: { type: "string", enum: ["yes", "no", "maybe"], description: "Your response" },
      },
      required: ["eventId", "status"],
    },
    // Self-service: an organiser scope here would stop a player whose token was
    // granted only read access from answering their own RSVP.
    scope: "read:events",
    handler: rsvp,
  },
  {
    name: "convocados_follow_event",
    description:
      "Follow a Game you do not play in, to get event-change and recruitment notifications. Self-service; playing in a Game already implies following it.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string", description: "Event ID" } },
      required: ["eventId"],
    },
    scope: "read:events",
    handler: followEvent,
  },
  {
    name: "convocados_unfollow_event",
    description:
      "Stop following a Game. Self-service; valid while you still hold a roster slot, which you then merely stop being notified about.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string", description: "Event ID" } },
      required: ["eventId"],
    },
    scope: "read:events",
    handler: unfollowEvent,
  },
  {
    name: "convocados_leave_event",
    description:
      "Leave a Game YOU are a player in: archives your roster slot, declines your RSVP and unfollows you. Self-service; cannot remove any other player.",
    inputSchema: {
      type: "object",
      properties: { eventId: { type: "string", description: "Event ID" } },
      required: ["eventId"],
    },
    scope: "read:events",
    handler: leaveEvent,
  },
  {
    name: "convocados_set_no_show",
    description:
      "Mark or unmark a player as a no-show for one specific game, which updates their attendance and no-show streak. Actor must own or admin the event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID the game belongs to" },
        gameId: { type: "string", description: "Game ID to mark" },
        eventPlayerId: { type: "string", description: "EventPlayer ID of the player" },
        noShow: { type: "boolean", description: "true to mark as no-show, false to undo the mark" },
      },
      required: ["eventId", "gameId", "eventPlayerId", "noShow"],
    },
    scope: "manage:players",
    handler: setNoShow,
  },
  {
    name: "convocados_set_teams",
    description:
      "Assign players to teams for a Game. Provide teamOnePlayerIds and teamTwoPlayerIds as arrays of player IDs. Actor must own or admin the event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        teamOnePlayerIds: {
          type: "array",
          items: { type: "string" },
          description: "Player IDs for team one",
        },
        teamTwoPlayerIds: {
          type: "array",
          items: { type: "string" },
          description: "Player IDs for team two",
        },
      },
      required: ["eventId", "teamOnePlayerIds", "teamTwoPlayerIds"],
    },
    scope: "manage:teams",
    handler: setTeams,
  },
  {
    name: "convocados_set_cost",
    description:
      "Set or update the cost for a Game. Recalculates per-player payment shares. Scope 'this_game' overrides only the current game; 'all_future' (default) updates the template. Actor must own or admin the event.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        totalAmount: { type: "number", description: "Total cost amount (must be positive)" },
        currency: { type: "string", description: "Currency code (default EUR)" },
        paymentDetails: { type: "string", description: "Payment instructions or notes" },
        scope: { type: "string", enum: ["this_game", "all_future"], description: "Cost scope (default all_future)" },
        paymentMethods: {
          type: "array",
          items: { type: "string" },
          description: "Accepted payment methods",
        },
      },
      required: ["eventId", "totalAmount"],
    },
    scope: "manage:payments",
    handler: setCost,
  },
  {
    name: "convocados_claim_player",
    description:
      "Claim an anonymous player slot and link it to your account. Self-service; renames the player across teams, ratings, and history.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        playerId: { type: "string", description: "Player ID or EventPlayer ID to claim" },
      },
      required: ["eventId", "playerId"],
    },
    scope: "read:events",
    handler: claimPlayer,
  },
];