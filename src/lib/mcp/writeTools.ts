import { prisma } from "../db.server";
import type { AuthContext } from "../authenticate.server";
import type { ToolDef } from "./tools";
import { McpError } from "./errors";
import { resolveRosterTarget, upsertEventPlayerForRoster, upsertGameParticipantForRoster } from "../rosterCore.server";
import { getActiveRosterState } from "../roster.server";
import { syncGamePayments } from "../settlement.server";
import { addPlayerToTeams, validateTeams } from "../../pages/api/events/[id]/players";
import { archiveAndLeave } from "../leave.server";
import { Randomize } from "../random";
import { balanceTeams, processGame } from "../elo.server";
import { recordReceived } from "../payments.server";
import { isGameEnded } from "../gameStatus";
import { serializeRecurrenceRule, type RecurrenceRule } from "../recurrence";
import { getDefaultDurationMinutes } from "../sports";
import { scheduleEventReminders } from "../scheduler.server";
import { fromDateTimeLocalValue } from "../timezones";

/**
 * MCP write tools (V1.5). All mutations reuse the same server-side libs as
 * the REST API routes so behavior (rosterCore, archiveAndLeave, ELO, ledger)
 * stays identical. Every event-scoped mutation is gated on the actor being
 * the event owner or an admin — an OAuth token alone is never enough to mutate
 * an event the user does not run.
 */

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

  const playerId = args.playerId as string | undefined;
  const name = args.name as string | undefined;
  let player: { id: string } | null = null;
  if (playerId) {
    player = await prisma.player.findFirst({ where: { id: playerId, eventId, archivedAt: null }, select: { id: true } });
    // ADR 0016: clients may pass an EventPlayer id (the Event GET surfaces those).
    if (!player) {
      const ep = await prisma.eventPlayer.findFirst({ where: { id: playerId, eventId }, select: { name: true } });
      if (ep) player = await prisma.player.findFirst({ where: { eventId, name: ep.name, archivedAt: null }, select: { id: true } });
    }
  } else if (typeof name === "string" && name.trim()) {
    player = await prisma.player.findFirst({ where: { eventId, name, archivedAt: null }, select: { id: true } });
  }
  if (!player) throw new McpError("Player not found.", -32001, 404);

  const result = await archiveAndLeave({
    eventId,
    playerId: player.id,
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
  let matches: { team: string; players: { name: string; order: number }[] }[];
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

  await prisma.$transaction([
    prisma.teamResult.deleteMany({ where: { eventId } }),
    ...matches.map((match) =>
      prisma.teamResult.create({
        data: {
          name: match.team,
          eventId,
          members: { create: match.players.map((p) => ({ name: p.name, order: p.order })) },
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
  const eventCost = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!eventCost) throw new McpError("No cost set for this event.", -32001, 404);
  const payment = await prisma.playerPayment.findUnique({
    where: { eventCostId_playerName: { eventCostId: eventCost.id, playerName } },
  });
  if (!payment) throw new McpError("Player payment not found.", -32001, 404);

  const method =
    args.method === undefined ? undefined : args.method === null ? null : String(args.method).trim().slice(0, 50) || null;

  const updated = await prisma.playerPayment.update({
    where: { id: payment.id },
    data: { status, paidAt: status === "paid" ? new Date() : null, ...(method !== undefined && { method }) },
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
  const isPublic = Boolean(args.isPublic);
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
    description: "Remove a player from a Game (soft-archive, triggers leave side-effects). Provide playerId or name.",
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
    description: "Generate/randomize teams for a Game from its active players. Set balanced=true to use ELO balancing.",
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
    description: "Update a player's payment status (pending|sent|paid) for a Game. paid writes the wallet ledger credit.",
    inputSchema: {
      type: "object",
      properties: {
        eventId: { type: "string", description: "Event ID" },
        playerName: { type: "string", description: "Player display name" },
        status: { type: "string", enum: ["pending", "sent", "paid"] },
        method: { type: "string", description: "Payment method label (mbway, revolut, cash, ...)" },
      },
      required: ["eventId", "playerName", "status"],
    },
    scope: "manage:payments",
    handler: updatePayment,
  },
  {
    name: "convocados_set_score",
    description: "Set the final score (scoreOne, scoreTwo) on the latest GameHistory for an Event. Triggers ELO processing.",
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
        recurrenceFreq: { type: "string", enum: ["daily", "weekly", "monthly", "yearly"] },
        recurrenceInterval: { type: "integer", description: "Recurrence interval (default 1)" },
      },
      required: ["title", "dateTime"],
    },
    scope: "create:events",
    handler: createEvent,
  },
];