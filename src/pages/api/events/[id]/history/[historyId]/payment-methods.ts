import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { checkOwnership } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { validatePaymentMethods, normalizePaymentMethod } from "~/lib/paymentMethods";
import type { PaymentMethod } from "~/lib/paymentMethods";

/**
 * PUT /api/events/[id]/history/[historyId]/payment-methods
 *
 * Sets (or clears) the per-game payment method override for a specific
 * GameHistory entry. When set, this game's participants see these methods
 * instead of the event default. Owner/Admin only.
 *
 * Body:
 *   { paymentMethods: PaymentMethod[] }   — set the override
 *   { paymentMethods: null, clear: true } — clear the override
 *
 * Response: { ok: true, paymentMethods: PaymentMethod[] | null }
 */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const historyId = params.historyId ?? "";

  const game = await prisma.gameHistory.findUnique({
    where: { id: historyId },
    select: { id: true, eventId: true, status: true },
  });
  if (!game || game.eventId !== eventId) {
    return Response.json({ error: "Game not found." }, { status: 404 });
  }
  if (game.status === "cancelled") {
    return Response.json({ error: "Cannot edit payment methods on a cancelled game." }, { status: 400 });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true },
  });
  if (!event) return Response.json({ error: "Event not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();

  // Clear path
  if (body.clear === true || body.paymentMethods === null) {
    await prisma.gameHistory.update({
      where: { id: historyId },
      data: { paymentMethods: null },
    });
    return Response.json({ ok: true, paymentMethods: null });
  }

  // Set path
  if (body.paymentMethods !== undefined) {
    if (Array.isArray(body.paymentMethods) && body.paymentMethods.length === 0) {
      // Empty array = clear
      await prisma.gameHistory.update({
        where: { id: historyId },
        data: { paymentMethods: null },
      });
      return Response.json({ ok: true, paymentMethods: null });
    }
    const err = validatePaymentMethods(body.paymentMethods);
    if (err) return Response.json({ error: err }, { status: 400 });
    const normalized = (body.paymentMethods as PaymentMethod[]).map(normalizePaymentMethod);
    await prisma.gameHistory.update({
      where: { id: historyId },
      data: { paymentMethods: JSON.stringify(normalized) },
    });
    return Response.json({ ok: true, paymentMethods: normalized });
  }

  return Response.json({ error: "paymentMethods or { clear: true } is required." }, { status: 400 });
};
