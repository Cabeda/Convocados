import type { APIRoute } from "astro";
import { prisma } from "../../../../../../lib/db.server";
import { processGame } from "../../../../../../lib/elo.server";
import { checkOwnership, getSession } from "../../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../../lib/apiRateLimit.server";
import { logEvent } from "../../../../../../lib/eventLog.server";

// POST /api/events/[id]/history/[historyId]/approve-elo
// Process ELO for a historical game that was created as a backfill
// Only owner/admin can approve, and only if eloProcessed is false
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
    return Response.json({ error: "Only the event owner or admin can approve ELO." }, { status: 403 });
  }

  const historyEntry = await prisma.gameHistory.findUnique({
    where: { id: params.historyId, eventId: params.id },
  });

  if (!historyEntry) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  if (historyEntry.source !== "historical") {
    return Response.json(
      { error: "Only historical games need ELO approval. Live games are processed automatically." },
      { status: 400 },
    );
  }

  if (historyEntry.eloProcessed) {
    return Response.json({ error: "ELO has already been processed for this game." }, { status: 400 });
  }

  if (!historyEntry.teamsSnapshot || historyEntry.scoreOne == null || historyEntry.scoreTwo == null) {
    return Response.json(
      { error: "Cannot process ELO: missing teams or scores." },
      { status: 400 },
    );
  }

  // Process the ELO update
  const teamsSnapshot = JSON.parse(historyEntry.teamsSnapshot);
  await processGame(
    params.id!,
    historyEntry.id,
    teamsSnapshot,
    historyEntry.scoreOne,
    historyEntry.scoreTwo,
  );

  const actor = session.user.name ?? session.user.email ?? "Unknown";
  const actorId = session.user.id;
  logEvent(params.id!, "history_elo_approved", actor, actorId, {
    historyId: historyEntry.id,
    date: historyEntry.dateTime.toISOString().slice(0, 10),
  });

  // Fetch updated entry to return
  const updated = await prisma.gameHistory.findUnique({ where: { id: params.historyId } });

  return Response.json({
    id: updated!.id,
    dateTime: updated!.dateTime.toISOString(),
    status: updated!.status,
    scoreOne: updated!.scoreOne,
    scoreTwo: updated!.scoreTwo,
    teamOneName: updated!.teamOneName,
    teamTwoName: updated!.teamTwoName,
    teamsSnapshot: updated!.teamsSnapshot,
    editableUntil: updated!.editableUntil.toISOString(),
    createdAt: updated!.createdAt.toISOString(),
    editable: updated!.editableUntil > new Date(),
    source: updated!.source,
    eloProcessed: updated!.eloProcessed,
  });
};
