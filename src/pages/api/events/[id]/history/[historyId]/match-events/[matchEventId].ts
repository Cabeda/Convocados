import type { APIRoute } from "astro";
import { prisma } from "../../../../../../../lib/db.server";
import { getSession } from "../../../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../../../lib/apiRateLimit.server";
import { logEvent } from "../../../../../../../lib/eventLog.server";
import { deriveScoreFromGoals, type MatchEventTeam } from "../../../../../../../lib/matchEvents";
import { isHistoryParticipant } from "../../../../../../../lib/snapshotParticipants";
import { authorizeEventMutation, eventMutationDenied, hasEventPasswordAccess } from "../../../../../../../lib/eventAuthz.server";

/**
 * DELETE — remove a Match Event and re-derive the game's score from what is
 * left. When the last goal goes, the manually entered score stands again.
 *
 * Same authorization as creating one (ADR 0039): Owner, Admin, Statistician,
 * or a participant of that Game.
 */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const event = await prisma.event.findUnique({ where: { id: params.id } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  const userId = session?.user?.id;
  if (!userId) return Response.json({ error: "Authentication required." }, { status: 401 });

  const history = await prisma.gameHistory.findUnique({
    where: { id: params.historyId, eventId: params.id },
  });
  if (!history) return Response.json({ error: "Game not found." }, { status: 404 });

  const isParticipant = isHistoryParticipant(history, session?.user?.name);
  const authz = await authorizeEventMutation(request, event, session);
  const passwordHeld = event.accessPassword
    ? await hasEventPasswordAccess(request, event, session)
    : false;
  if (!authz.isOwner && !authz.isAdmin && !passwordHeld && !(isParticipant && !event.accessPassword)) {
    return eventMutationDenied(
      event.accessPassword ? { ...authz, reason: "password_required" } : authz,
      "Forbidden.",
    );
  }

  // Scope the delete to this game so an id from another game cannot be removed.
  const existing = await prisma.matchEvent.findFirst({
    where: { id: params.matchEventId, gameHistoryId: history.id },
  });
  if (!existing) return Response.json({ error: "Match event not found." }, { status: 404 });

  await prisma.matchEvent.delete({ where: { id: existing.id } });

  const remaining = await prisma.matchEvent.findMany({
    where: { gameHistoryId: history.id, type: "goal" },
  });
  const derived = deriveScoreFromGoals(
    remaining.map((g) => ({ team: g.team as MatchEventTeam, ownGoal: g.ownGoal, count: g.count })),
  );
  const updated = derived
    ? await prisma.gameHistory.update({
        where: { id: history.id },
        data: { scoreOne: derived.teamOne, scoreTwo: derived.teamTwo },
      })
    : history;

  logEvent(
    params.id ?? "",
    "history_match_event_deleted",
    session?.user?.name ?? null,
    userId,
    { historyId: history.id, type: existing.type, scorerName: existing.scorerName },
  ).catch(() => {});

  return Response.json({
    ok: true,
    score: derived ?? { teamOne: updated.scoreOne ?? 0, teamTwo: updated.scoreTwo ?? 0 },
  });
};
