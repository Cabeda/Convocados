import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getScoringType } from "../../../../lib/scoring";

interface Tally {
  name: string;
  eventPlayerId: string | null;
  goals: number;
  assists: number;
  ownGoals: number;
  penalties: number;
}

/**
 * GET — the per-player scorer table for an Event, replayed from its Match
 * Events (ADR 0039). No denormalized counters: the timeline is the source.
 */
export const GET: APIRoute = async ({ params }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  if (getScoringType(event.sport) === "tennis") {
    return Response.json({ scorers: [], scoringType: "tennis" });
  }

  const events = await prisma.matchEvent.findMany({
    where: { gameHistory: { eventId: params.id } },
    select: {
      type: true,
      ownGoal: true,
      penalty: true,
      scorerEventPlayerId: true,
      scorerName: true,
      assistEventPlayerId: true,
      assistName: true,
    },
  });

  const byKey = new Map<string, Tally>();
  const keyFor = (id: string | null, name: string) => id ?? `name:${name.toLowerCase()}`;
  function tally(id: string | null, name: string): Tally {
    const key = keyFor(id, name);
    let entry = byKey.get(key);
    if (!entry) {
      entry = { name, eventPlayerId: id, goals: 0, assists: 0, ownGoals: 0, penalties: 0 };
      byKey.set(key, entry);
    }
    return entry;
  }

  for (const e of events) {
    if (e.type === "goal") {
      const scorer = tally(e.scorerEventPlayerId, e.scorerName);
      scorer.goals += 1;
      if (e.ownGoal) scorer.ownGoals += 1;
      if (e.penalty) scorer.penalties += 1;
      if (e.assistName) tally(e.assistEventPlayerId, e.assistName).assists += 1;
    }
  }

  const scorers = Array.from(byKey.values())
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name));

  return Response.json({ scorers, scoringType: "standard" });
};
