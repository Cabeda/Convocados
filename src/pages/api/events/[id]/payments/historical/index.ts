import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { checkOwnership, getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { settleHistoricalGame } from "~/lib/payments.server";

/**
 * POST /api/events/[id]/payments/historical
 *
 * Body: { gameHistoryId: string, playerName: string, amountCents?: number, method?: string }
 *
 * Records a Historical Settlement (ADR 0019): a payment_received row in the
 * WalletTransaction ledger with `gameHistoryId` set, netted against the
 * frozen `GameHistory.paymentsSnapshot` entry on the read side. Owner/Admin only.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }
  const session = await getSession(request);
  const markedById = session?.user?.id ?? event.ownerId ?? "";

  const body = await request.json();
  const gameHistoryId = String(body.gameHistoryId ?? "").trim();
  const playerName = String(body.playerName ?? "").trim();
  const amountCents = typeof body.amountCents === "number" ? body.amountCents : undefined;
  const method = body.method ? String(body.method).trim().slice(0, 50) : null;

  if (!gameHistoryId || !playerName) {
    return Response.json({ error: "gameHistoryId and playerName are required." }, { status: 400 });
  }

  const result = await settleHistoricalGame({
    eventId,
    gameHistoryId,
    playerName,
    markedById,
    method,
    amountCents,
  });

  if (result.reason === "no-event-player" || result.reason === "no-snapshot") {
    return Response.json({ error: `Cannot settle: ${result.reason}.` }, { status: 404 });
  }
  if (result.reason === "already-settled") {
    return Response.json({ ok: true, written: false, walletTransactionId: result.walletTransactionId }, { status: 200 });
  }
  return Response.json({ ok: true, written: true, walletTransactionId: result.walletTransactionId });
};
