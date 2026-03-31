import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { parsePaginationParams, buildPaginatedResponse } from "../../../../../lib/pagination";
import { checkOwnership, getSession } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { logEvent } from "../../../../../lib/eventLog.server";

// GET /api/events/[id]/history — paginated history entries
export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const url = new URL(request.url);
  const { limit, cursor } = parsePaginationParams(url);

  const history = await prisma.gameHistory.findMany({
    where: { eventId: params.id },
    orderBy: { dateTime: "desc" },
    take: limit + 1,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
  });

  // Fetch ALL history for ELO replay (needed for accurate deltas)
  const allHistory = await prisma.gameHistory.findMany({
    where: { eventId: params.id },
    orderBy: { dateTime: "asc" },
  });
  const eloMap = computeHistoryDeltas(params.id!, allHistory);

  const mapped = history.map((h) => ({
    id: h.id,
    dateTime: h.dateTime.toISOString(),
    status: h.status,
    scoreOne: h.scoreOne,
    scoreTwo: h.scoreTwo,
    teamOneName: h.teamOneName,
    teamTwoName: h.teamTwoName,
    teamsSnapshot: h.teamsSnapshot,
    paymentsSnapshot: h.paymentsSnapshot,
    editableUntil: h.editableUntil.toISOString(),
    createdAt: h.createdAt.toISOString(),
    editable: h.editableUntil > new Date(),
    source: h.source,
    eloUpdates: eloMap.get(h.id) ?? null,
  }));

  return Response.json(buildPaginatedResponse(mapped, limit));
};

/** Replay ELO from scratch in memory to get per-game deltas without touching the DB */
function computeHistoryDeltas(
  eventId: string,
  history: { id: string; status: string; scoreOne: number | null; scoreTwo: number | null; teamsSnapshot: string | null; dateTime: Date }[],
): Map<string, { name: string; delta: number }[]> {
  const result = new Map<string, { name: string; delta: number }[]>();
  const ratings = new Map<string, number>();

  // Process in chronological order
  const sorted = [...history].sort((a, b) => a.dateTime.getTime() - b.dateTime.getTime());

  for (const game of sorted) {
    if (game.status !== "played" || game.scoreOne == null || game.scoreTwo == null || !game.teamsSnapshot) continue;

    let teams: { team: string; players: { name: string }[] }[];
    try { teams = JSON.parse(game.teamsSnapshot); } catch { continue; }
    if (teams.length !== 2) continue;

    const t1 = teams[0].players.map((p) => p.name);
    const t2 = teams[1].players.map((p) => p.name);
    const all = [...t1, ...t2];

    // Ensure all players have a rating
    for (const name of all) {
      if (!ratings.has(name)) ratings.set(name, 1000);
    }

    const avg = (names: string[]) => names.reduce((s, n) => s + ratings.get(n)!, 0) / names.length;
    const teamOneElo = avg(t1);
    const teamTwoElo = avg(t2);
    const outcome = game.scoreOne > game.scoreTwo ? 1 : game.scoreOne < game.scoreTwo ? 0 : 0.5;

    const deltas: { name: string; delta: number }[] = [];
    for (const name of all) {
      const r = ratings.get(name)!;
      const isT1 = t1.includes(name);
      const pOutcome = isT1 ? outcome : 1 - outcome;
      const oppElo = isT1 ? teamTwoElo : teamOneElo;
      const expected = 1 / (1 + Math.pow(10, (oppElo - r) / 400));
      const k = 32;
      const delta = Math.round(k * (pOutcome - expected));
      ratings.set(name, r + delta);
      deltas.push({ name, delta });
    }
    result.set(game.id, deltas);
  }

  return result;
}

// POST /api/events/[id]/history — create a historical game (owner/admin only)
// Historical games are NOT automatically processed for ELO — they must be approved separately
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, params.id);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner or admin can add historical games." }, { status: 403 });
  }

  const body = await request.json();

  // Validate required fields
  const { dateTime, teamOneName, teamTwoName, scoreOne, scoreTwo, teamsSnapshot } = body;

  if (!dateTime || !teamOneName || !teamTwoName || scoreOne === undefined || scoreTwo === undefined || !teamsSnapshot) {
    return Response.json(
      { error: "Missing required fields: dateTime, teamOneName, teamTwoName, scoreOne, scoreTwo, teamsSnapshot" },
      { status: 400 },
    );
  }

  // Parse and validate teamsSnapshot structure
  let parsedTeams: { team: string; players: { name: string; order: number }[] }[];
  try {
    parsedTeams = teamsSnapshot;
    if (!Array.isArray(parsedTeams) || parsedTeams.length !== 2) {
      return Response.json({ error: "teamsSnapshot must contain exactly 2 teams" }, { status: 400 });
    }
    for (const team of parsedTeams) {
      if (!team.team || !Array.isArray(team.players)) {
        return Response.json({ error: "Invalid teamsSnapshot structure" }, { status: 400 });
      }
    }
  } catch {
    return Response.json({ error: "Invalid teamsSnapshot format" }, { status: 400 });
  }

  const history = await prisma.gameHistory.create({
    data: {
      eventId: params.id!,
      dateTime: new Date(dateTime),
      teamOneName,
      teamTwoName,
      scoreOne: parseInt(String(scoreOne), 10),
      scoreTwo: parseInt(String(scoreTwo), 10),
      teamsSnapshot: JSON.stringify(teamsSnapshot),
      status: "played",
      source: "historical",
      eloProcessed: false,
      editableUntil: new Date(Date.now() + 7 * 86400_000), // 7 days to approve/reject
    },
  });

  const actor = session.user.name ?? session.user.email ?? "Unknown";
  const actorId = session.user.id;
  logEvent(params.id!, "history_backfill_created", actor, actorId, {
    historyId: history.id,
    date: new Date(dateTime).toISOString().slice(0, 10),
  });

  return Response.json(
    {
      id: history.id,
      dateTime: history.dateTime.toISOString(),
      status: history.status,
      scoreOne: history.scoreOne,
      scoreTwo: history.scoreTwo,
      teamOneName: history.teamOneName,
      teamTwoName: history.teamTwoName,
      teamsSnapshot: history.teamsSnapshot,
      editableUntil: history.editableUntil.toISOString(),
      createdAt: history.createdAt.toISOString(),
      editable: history.editableUntil > new Date(),
      source: history.source,
      eloProcessed: history.eloProcessed,
    },
    { status: 201 },
  );
};
