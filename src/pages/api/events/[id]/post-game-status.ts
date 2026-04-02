import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { isGameEnded } from "../../../../lib/gameStatus";

/**
 * GET /api/events/:id/post-game-status
 *
 * Returns the post-game completion status for an event:
 * - gameEnded: whether dateTime + durationMinutes is in the past
 * - hasScore: whether a GameHistory record exists with scoreOne/scoreTwo set
 * - allPaid: whether all payments are paid/exempt (or no cost set)
 * - allComplete: hasScore && allPaid
 */
export const GET: APIRoute = async ({ params }) => {
  const event = await prisma.event.findUnique({
    where: { id: params.id },
    select: { id: true, dateTime: true, durationMinutes: true },
  });

  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const gameEnded = isGameEnded(event.dateTime, event.durationMinutes);

  // Check if the most recent game history has a score recorded
  const latestHistory = await prisma.gameHistory.findFirst({
    where: { eventId: event.id },
    orderBy: { dateTime: "desc" },
    select: { scoreOne: true, scoreTwo: true },
  });
  const hasScore = !!(latestHistory && latestHistory.scoreOne !== null && latestHistory.scoreTwo !== null);

  // Check payment status
  const eventCost = await prisma.eventCost.findUnique({
    where: { eventId: event.id },
    include: { payments: { select: { status: true } } },
  });

  let allPaid = true;
  if (eventCost && eventCost.payments.length > 0) {
    allPaid = eventCost.payments.every(
      (p) => p.status === "paid" || p.status === "exempt",
    );
  }

  const allComplete = hasScore && allPaid;

  return Response.json({ gameEnded, hasScore, allPaid, allComplete });
};
