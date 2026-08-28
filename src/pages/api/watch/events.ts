import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession, checkOwnership } from "../../../lib/auth.helpers.server";
import { getScoringType, parseScoreSets } from "../../../lib/scoring";

/** How many minutes before/after the event dateTime we consider it "happening now" */
const HAPPENING_WINDOW_MS = 90 * 60 * 1000; // 90 minutes

/**
 * POST /api/watch/events
 * Auto-creates a GameHistory record for an event so the watch can start tracking
 * scores without waiting for recurrence rollover. Teams are optional: a solo
 * organizer may begin scoring before teams are set (history falls back to the
 * event's default team names / empty snapshot).
 */
export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const body = await request.json();
  const eventId = body.eventId;
  if (!eventId || typeof eventId !== "string") {
    return Response.json({ error: "eventId is required." }, { status: 400 });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: {
      teamResults: {
        select: { id: true, name: true, members: { select: { name: true, order: true } } },
      },
      history: {
        where: { status: "played" },
        orderBy: { dateTime: "desc" },
        take: 1,
      },
    },
  });

  if (!event) {
    return Response.json({ error: "Event not found." }, { status: 404 });
  }

  // Check that the user is the owner, admin, or a player in this event
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
  const isPlayer = await prisma.player.findFirst({
    where: { eventId, userId: session.user.id, archivedAt: null },
  });

  if (!isOwner && !isAdmin && !isPlayer) {
    return Response.json({ error: "You must be the event owner, an admin, or a player in this game to start scoring." }, { status: 403 });
  }

  // Check if there's already a history record for today
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const existingToday = await prisma.gameHistory.findFirst({
    where: {
      eventId,
      dateTime: { gte: startOfDay },
      status: "played",
    },
  });

  if (existingToday) {
    // Already has a history record — return it
    return Response.json({
      id: existingToday.id,
      scoreOne: existingToday.scoreOne,
      scoreTwo: existingToday.scoreTwo,
      scoreSets: parseScoreSets(existingToday.scoreSets),
      scoringType: getScoringType(event.sport),
      teamOneName: existingToday.teamOneName,
      teamTwoName: existingToday.teamTwoName,
      created: false,
    });
  }

  // Create a new history record. teamsSnapshot is null when the event has no
  // teamResults yet (watch can start scoring without teams) — an empty-array
  // snapshot is still truthy and would trip the ELO/processGame "needs teams"
  // guards downstream.
  const teamsSnapshot = event.teamResults.length
    ? JSON.stringify(
        event.teamResults.map((tr) => ({
          team: tr.name,
          players: tr.members.map((m) => ({ name: m.name, order: m.order })),
        }))
      )
    : null;

  const history = await prisma.gameHistory.create({
    data: {
      eventId: event.id,
      dateTime: event.dateTime,
      teamOneName: event.teamOneName || "Team 1",
      teamTwoName: event.teamTwoName || "Team 2",
      teamsSnapshot,
    },
  });

  return Response.json({
    id: history.id,
    scoreOne: history.scoreOne,
    scoreTwo: history.scoreTwo,
    scoreSets: parseScoreSets(history.scoreSets),
    scoringType: getScoringType(event.sport),
    teamOneName: history.teamOneName,
    teamTwoName: history.teamTwoName,
    created: true,
  });
};

/**
 * GET /api/watch/events
 * Returns today's events that have teams assigned, with current scores.
 *
 * For logged-in users: filters to events where the user is a player.
 * For anonymous users: returns all today's events with teams.
 *
 * Response includes `autoSelectId` — the event to auto-navigate to when:
 *   - There is exactly one event, OR
 *   - Exactly one event is "happening now" (within ±90 min of dateTime)
 */
export const GET: APIRoute = async ({ request }) => {
  const url = new URL(request.url);
  const eventId = url.searchParams.get("eventId");

  // If eventId is provided, return just that event's data
  if (eventId) {
    return getSingleEvent(eventId);
  }

  const session = await getSession(request);
  const userId = session?.user?.id ?? null;

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const where: Record<string, unknown> = {
    dateTime: { gte: startOfDay, lte: endOfDay },
    archivedAt: null,
  };

  // For logged-in users, only show events they participate in
  if (userId) {
    where.players = { some: { userId } };
  }

  const events = await prisma.event.findMany({
    where,
    select: {
      id: true,
      title: true,
      sport: true,
      dateTime: true,
      teamOneName: true,
      teamTwoName: true,
      teamResults: {
        select: { id: true, name: true, members: { select: { name: true } } },
      },
      history: {
        where: {
          dateTime: { gte: startOfDay, lte: endOfDay },
          status: "played",
        },
        orderBy: { dateTime: "desc" },
        take: 1,
        select: {
          id: true,
          scoreOne: true,
          scoreTwo: true,
          scoreSets: true,
          teamOneName: true,
          teamTwoName: true,
        },
      },
    },
    orderBy: { dateTime: "asc" },
  });

  const now = Date.now();

  const mapped = events.map((e) => {
    const diff = Math.abs(e.dateTime.getTime() - now);
    const hasTeams = e.teamResults.length >= 2;
    return {
      id: e.id,
      title: e.title,
      sport: e.sport,
      dateTime: e.dateTime.toISOString(),
      teamOneName: e.teamOneName,
      teamTwoName: e.teamTwoName,
      hasTeams,
      isHappeningNow: diff <= HAPPENING_WINDOW_MS,
      hasHistory: e.history.length > 0,
      latestGame: e.history[0]
        ? {
            id: e.history[0].id,
            scoreOne: e.history[0].scoreOne,
            scoreTwo: e.history[0].scoreTwo,
            scoreSets: parseScoreSets(e.history[0].scoreSets),
            scoringType: getScoringType(e.sport),
            teamOneName: e.history[0].teamOneName,
            teamTwoName: e.history[0].teamTwoName,
          }
        : null,
    };
  });

  // Auto-select logic (only for logged-in users, only events with teams)
  let autoSelectId: string | null = null;
  if (userId) {
    const ready = mapped.filter((e) => e.hasTeams);
    const happeningNow = ready.filter((e) => e.isHappeningNow);
    if (happeningNow.length === 1) {
      autoSelectId = happeningNow[0].id;
    } else if (ready.length === 1) {
      autoSelectId = ready[0].id;
    }
  }

  return Response.json({ events: mapped, autoSelectId });
};

async function getSingleEvent(eventId: string) {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: {
      id: true,
      title: true,
      sport: true,
      dateTime: true,
      teamOneName: true,
      teamTwoName: true,
      teamResults: {
        select: { id: true, name: true, members: { select: { name: true } } },
      },
      history: {
        where: { status: "played" },
        orderBy: { dateTime: "desc" },
        take: 1,
        select: {
          id: true,
          scoreOne: true,
          scoreTwo: true,
          scoreSets: true,
          teamOneName: true,
          teamTwoName: true,
        },
      },
    },
  });

  if (!event) {
    return Response.json({ error: "Event not found" }, { status: 404 });
  }

  const now = Date.now();
  const diff = Math.abs(event.dateTime.getTime() - now);

  const hasTeams = event.teamResults.length >= 2;

  return Response.json({
    id: event.id,
    title: event.title,
    sport: event.sport,
    dateTime: event.dateTime.toISOString(),
    teamOneName: event.teamOneName,
    teamTwoName: event.teamTwoName,
    hasTeams,
    isHappeningNow: diff <= HAPPENING_WINDOW_MS,
    hasHistory: event.history.length > 0,
    latestGame: event.history[0]
      ? {
          id: event.history[0].id,
          scoreOne: event.history[0].scoreOne,
          scoreTwo: event.history[0].scoreTwo,
          scoreSets: parseScoreSets(event.history[0].scoreSets),
          scoringType: getScoringType(event.sport),
          teamOneName: event.history[0].teamOneName,
          teamTwoName: event.history[0].teamTwoName,
        }
      : null,
  });
}
