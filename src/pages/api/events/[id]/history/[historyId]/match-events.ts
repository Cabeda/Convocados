import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { getSession } from "../../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../../lib/apiRateLimit.server";
import { logEvent } from "../../../../../../lib/eventLog.server";
import { getScoringType } from "../../../../../../lib/scoring";
import {
  deriveScoreFromGoals,
  type MatchEventTeam,
  type MatchEventType,
} from "../../../../../../lib/matchEvents";
import { isHistoryParticipant } from "../../../../../../lib/snapshotParticipants";

const EVENT_TYPES: MatchEventType[] = ["goal", "assist"];
const TEAMS: MatchEventTeam[] = ["one", "two", "unknown"];

function toTeam(value: unknown): MatchEventTeam | undefined {
  return typeof value === "string" && (TEAMS as string[]).includes(value)
    ? (value as MatchEventTeam)
    : undefined;
}

function toMinute(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 200) {
    return undefined;
  }
  return value;
}

async function resolveScorer(eventId: string, eventPlayerId: unknown, fallbackName: unknown) {
  if (typeof eventPlayerId === "string" && eventPlayerId) {
    const player = await prisma.eventPlayer.findFirst({ where: { id: eventPlayerId, eventId } });
    if (!player) return null;
    return { id: player.id, name: player.name };
  }
  if (typeof fallbackName === "string" && fallbackName.trim()) {
    const name = fallbackName.trim();
    const player = await prisma.eventPlayer.findFirst({ where: { eventId, name } });
    return { id: player?.id ?? null, name: player?.name ?? name };
  }
  return null;
}

/** GET — the game's Match Event timeline and the score derived from its goals. */
export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const history = await prisma.gameHistory.findUnique({
    where: { id: params.historyId, eventId: params.id },
  });
  if (!history) return Response.json({ error: "Game not found." }, { status: 404 });

  const session = await getSession(request);
  if (!event.showCompetitiveData && event.ownerId && session?.user?.id !== event.ownerId) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const events = await prisma.matchEvent.findMany({
    where: { gameHistoryId: history.id },
    orderBy: [{ minute: "asc" }, { createdAt: "asc" }],
  });

  const goals = events.filter((e) => e.type === "goal");
  const score = deriveScoreFromGoals(
    goals.map((g) => ({ team: g.team as MatchEventTeam, ownGoal: g.ownGoal })),
  );

  return Response.json({
    events: events.map((e) => ({
      id: e.id,
      type: e.type,
      team: e.team,
      minute: e.minute,
      ownGoal: e.ownGoal,
      penalty: e.penalty,
      scorerEventPlayerId: e.scorerEventPlayerId,
      scorerName: e.scorerName,
      assistEventPlayerId: e.assistEventPlayerId,
      assistName: e.assistName,
      createdAt: e.createdAt.toISOString(),
    })),
    score,
    scoringType: getScoringType(event.sport),
  });
};

/**
 * POST — log a Match Event on a settled Game.
 *
 * Allowed for the Owner, an Admin, a Statistician (this route only), or a
 * participant of that Game (ADR 0039). Set-based sports keep their set score.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });

  if (getScoringType(event.sport) === "tennis") {
    return Response.json(
      { error: "Match events are not supported for set-based sports." },
      { status: 400 },
    );
  }

  const history = await prisma.gameHistory.findUnique({
    where: { id: params.historyId, eventId: params.id },
  });
  if (!history) return Response.json({ error: "Game not found." }, { status: 404 });
  if (history.status !== "played") {
    return Response.json({ error: "Match events can only be logged on played games." }, { status: 400 });
  }

  const isOwner = !!event.ownerId && event.ownerId === userId;
  const admin = isOwner
    ? null
    : await prisma.eventAdmin.findUnique({
        where: { eventId_userId: { eventId: params.id ?? "", userId } },
      });
  const isParticipant = isHistoryParticipant(history, session?.user?.name);
  if (!isOwner && !admin && !isParticipant) {
    return Response.json({ error: "Forbidden." }, { status: 403 });
  }

  const body = await request.json();
  const type = typeof body.type === "string" && (EVENT_TYPES as string[]).includes(body.type)
    ? (body.type as MatchEventType)
    : "goal";
  const team = toTeam(body.team);
  if (type === "goal" && team !== "one" && team !== "two") {
    return Response.json({ error: "team must be one or two for a goal." }, { status: 400 });
  }
  const minute = toMinute(body.minute);
  if (minute === undefined) {
    return Response.json({ error: "minute must be an integer between 0 and 200." }, { status: 400 });
  }

  const scorer = await resolveScorer(params.id ?? "", body.scorerEventPlayerId, body.scorerName);
  if (!scorer) {
    return Response.json({ error: "scorerEventPlayerId or scorerName is required." }, { status: 400 });
  }

  const assist = body.assistEventPlayerId || body.assistName
    ? await resolveScorer(params.id ?? "", body.assistEventPlayerId, body.assistName)
    : null;

  const created = await prisma.matchEvent.create({
    data: {
      gameHistoryId: history.id,
      type,
      team: team ?? "unknown",
      minute: minute ?? null,
      ownGoal: body.ownGoal === true,
      penalty: body.penalty === true,
      scorerEventPlayerId: scorer.id,
      scorerName: scorer.name,
      assistEventPlayerId: assist?.id ?? null,
      assistName: assist?.name ?? null,
      createdById: userId,
    },
  });

  const storedGoals = await prisma.matchEvent.findMany({
    where: { gameHistoryId: history.id, type: "goal" },
  });
  const derived = deriveScoreFromGoals(
    storedGoals.map((g) => ({ team: g.team as MatchEventTeam, ownGoal: g.ownGoal })),
  );

  const updated = derived
    ? await prisma.gameHistory.update({
        where: { id: history.id },
        data: { scoreOne: derived.teamOne, scoreTwo: derived.teamTwo },
      })
    : history;

  logEvent(
    params.id ?? "",
    "history_match_event_created",
    session?.user?.name ?? null,
    userId,
    { historyId: history.id, type, team: team ?? "unknown", scorerName: scorer.name },
  ).catch(() => {});

  return Response.json({
    ok: true,
    event: {
      id: created.id,
      type: created.type,
      team: created.team,
      minute: created.minute,
      ownGoal: created.ownGoal,
      penalty: created.penalty,
      scorerEventPlayerId: created.scorerEventPlayerId,
      scorerName: created.scorerName,
      assistEventPlayerId: created.assistEventPlayerId,
      assistName: created.assistName,
      createdAt: created.createdAt.toISOString(),
    },
    score: derived ?? { teamOne: updated.scoreOne ?? 0, teamTwo: updated.scoreTwo ?? 0 },
  }, { status: 201 });
};
