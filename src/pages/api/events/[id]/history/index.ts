import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";

// GET /api/events/[id]/history — list all history entries
export const GET: APIRoute = async ({ params }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const history = await prisma.gameHistory.findMany({
    where: { eventId: params.id },
    orderBy: { dateTime: "desc" },
  });

  // Fetch all ratings to compute deltas per game via replay
  // For simplicity, we replay chronologically and record deltas per game
  const eloMap = await computeHistoryDeltas(params.id!, history);

  return Response.json(history.map((h) => ({
    ...h,
    dateTime: h.dateTime.toISOString(),
    editableUntil: h.editableUntil.toISOString(),
    createdAt: h.createdAt.toISOString(),
    editable: h.editableUntil > new Date(),
    eloUpdates: eloMap.get(h.id) ?? null,
  })));
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
      const gp = all.filter(() => true).length; // simplified — use fixed K for replay
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
