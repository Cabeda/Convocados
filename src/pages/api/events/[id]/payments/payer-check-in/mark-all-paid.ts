import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { bulkSettleGame } from "~/lib/settlement.server";
import { resolvePayerCheckInRequest } from "~/lib/payerCheckInRequest.server";

/**
 * POST /api/events/[id]/payments/payer-check-in/mark-all-paid
 * #1236: the payer answers the 24h check-in with "everyone paid" — settle
 * every unpaid share of the game (dual-writes the ledger).
 * Body: { gameId }
 */
export const POST: APIRoute = async ({ params, request }) => {
  const resolved = await resolvePayerCheckInRequest(params, request);
  if (!resolved.ok) return resolved.response;
  const { event, game, userId } = resolved;

  try {
    const updated = await bulkSettleGame(event.id, game.id, userId);
    // The payer answered the check-in — stop asking about this game.
    await prisma.game.update({
      where: { id: game.id },
      data: { payerCheckInSentAt: new Date(), payerCheckInSnoozedUntil: null },
    });
    return Response.json({ ok: true, updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to settle game.";
    return Response.json({ error: message }, { status: 400 });
  }
};
