import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getScoringType } from "../../../../lib/scoring";
import { checkOwnership, getSession } from "../../../../lib/auth.helpers.server";
import { checkAccess } from "../../../../lib/eventAccess";

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
export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const scoringType = getScoringType(event.sport) === "tennis" ? "tennis" : "standard";

  let isPrivileged = false;
  if (event.accessPassword || !event.showCompetitiveData) {
    const session = await getSession(request);
    const { isOwner, isAdmin } = await checkOwnership(
      request,
      event.ownerId,
      session ?? undefined,
      event.id,
    );
    isPrivileged = isOwner || isAdmin;

    if (event.accessPassword && !isPrivileged) {
      const isInvited = session?.user
        ? (await prisma.eventInvite.count({
            where: { eventId: event.id, userId: session.user.id },
          })) > 0
        : false;
      const access = checkAccess({
        eventOwnerId: event.ownerId,
        accessPassword: event.accessPassword,
        requestUserId: session?.user?.id ?? null,
        cookieHeader: request.headers.get("cookie"),
        eventId: event.id,
        isInvited,
      });
      if (!access.granted) {
        return Response.json({ error: "Event access required." }, { status: 403 });
      }
    }
  }

  if (!event.showCompetitiveData && !isPrivileged) {
    return Response.json({ scorers: [], scoringType });
  }

  if (scoringType === "tennis") {
    return Response.json({ scorers: [], scoringType: "tennis" });
  }

  const events = await prisma.matchEvent.findMany({
    where: { gameHistory: { eventId: params.id } },
    select: {
      type: true,
      ownGoal: true,
      penalty: true,
      count: true,
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
      scorer.goals += e.count ?? 1;
      if (e.ownGoal) scorer.ownGoals += e.count ?? 1;
      if (e.penalty) scorer.penalties += e.count ?? 1;
      if (e.assistName) tally(e.assistEventPlayerId, e.assistName).assists += 1;
    }
  }

  const scorers = Array.from(byKey.values())
    .sort((a, b) => b.goals - a.goals || b.assists - a.assists || a.name.localeCompare(b.name));

  return Response.json({ scorers, scoringType });
};
