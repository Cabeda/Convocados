import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { isGameEnded } from "../../../../lib/gameStatus";
import { getSession } from "../../../../lib/auth.helpers.server";

/**
 * GET /api/events/:id/post-game-status
 *
 * Returns the post-game completion status for an event:
 * - gameEnded: whether dateTime + durationMinutes is in the past
 * - hasScore: whether the most recent GameHistory has scoreOne/scoreTwo set
 * - hasCost: whether an EventCost record exists with totalAmount > 0
 * - allPaid: whether all payments are paid/exempt (or no cost set)
 * - allComplete: hasScore && allPaid
 * - isParticipant: whether the current user is a participant (name match or claimed spot)
 */
export const GET: APIRoute = async ({ params, request }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { id: true, dateTime: true, durationMinutes: true, ownerId: true },
  });

  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const gameEnded = isGameEnded(event.dateTime, event.durationMinutes);

  // Check if the most recent game history has a score recorded
  const latestHistory = await prisma.gameHistory.findFirst({
    where: { eventId: event.id },
    orderBy: { dateTime: "desc" },
    select: { scoreOne: true, scoreTwo: true, teamsSnapshot: true },
  });
  const hasScore = !!(latestHistory && latestHistory.scoreOne !== null && latestHistory.scoreTwo !== null);

  // Check payment status
  const eventCost = await prisma.eventCost.findUnique({
    where: { eventId: event.id },
    include: { payments: { select: { status: true } } },
  });

  const hasCost = !!(eventCost && eventCost.totalAmount > 0);

  let allPaid = true;
  if (eventCost && eventCost.payments.length > 0) {
    allPaid = eventCost.payments.every(
      (p) => p.status === "paid" || p.status === "exempt",
    );
  }

  const allComplete = hasScore && allPaid;

  // Check if the current user is a participant
  let isParticipant = false;
  const session = await getSession(request);
  if (session?.user) {
    // Owner/admin is always a participant
    if (event.ownerId && session.user.id === event.ownerId) {
      isParticipant = true;
    }

    // Check name match against latest history teamsSnapshot
    if (!isParticipant && latestHistory?.teamsSnapshot && session.user.name) {
      try {
        const teams = JSON.parse(latestHistory.teamsSnapshot) as Array<{ players: Array<{ name: string }> }>;
        const allNames = teams.flatMap((t) => t.players.map((p) => p.name.toLowerCase()));
        isParticipant = allNames.includes(session.user.name.toLowerCase());
      } catch { /* ignore */ }
    }

    // Check claimed player spot
    if (!isParticipant) {
      const claimed = await prisma.player.findFirst({
        where: { eventId: params.id, userId: session.user.id, archivedAt: null },
      });
      if (claimed) isParticipant = true;
    }
  }

  return Response.json({ gameEnded, hasScore, hasCost, allPaid, allComplete, isParticipant });
};
