import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";

import { authorizeEventMutation } from "../../../../lib/eventAuthz.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../../lib/authenticate.server";
import { canReadEventFinances } from "../../../../lib/eventReadAccess.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { summarizePayments } from "../../../../lib/paymentSummary";
import { setEventCost } from "../../../../lib/eventCost.server";
import { effectivePaymentMethodsRaw } from "../../../../lib/paymentMethods";
import { resolvePaymentDetails } from "../../../../lib/paymentDetailsResolve.server";

/** PUT — set or update event cost. Creates/recalculates player payment records. */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { where: { archivedAt: null }, orderBy: { order: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();

  try {
    const result = await setEventCost(eventId, body);
    return Response.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : `Non-Error: ${JSON.stringify(err)}`;
    if (message.includes("totalAmount") || message.includes("monthly") || message.includes("dropIn") || message.includes("payment") || message.includes("Invalid type") || message.includes("revolut") || message.includes("Phone number") || message.includes("Value is required")) {
      return Response.json({ error: message }, { status: 400 });
    }
    if (message.includes("No active game")) {
      return Response.json({ error: message }, { status: 400 });
    }
    throw err;
  }
};

/** GET — get event cost with payments and summary. Owner/admin/participant (or ownerless-unlisted link access). */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id ?? null;

  if (!(await canReadEventFinances(request, event, userId))) {
    return Response.json({ error: "Only event participants can view costs." }, { status: 403 });
  }

  const eventCost = await prisma.eventCost.findUnique({
    where: { eventId },
    include: { payments: { orderBy: { playerName: "asc" } } },
  });

  if (!eventCost) return Response.json(null);

  const { paidCount, paidAmount } = summarizePayments(eventCost.payments);

  const hasOverride = !!(eventCost.tempPaymentMethods || eventCost.tempPaymentDetails);

  // The crew pays the Payer, not the organizer. Resolve the same account the
  // game_payer_set/nudge payload uses; a game with no payer (or a stood-down
  // one) shows "nobody is collecting" instead of falling back to the Event's
  // organizer account.
  let payerName: string | null = null;
  let resolvedPaymentMethods: unknown[] = [];
  let paymentSource = "none";
  let viewerIsPayer = false;
  if (event.currentGameId) {
    const game = await prisma.game.findUnique({
      where: { id: event.currentGameId },
      select: {
        payerStoodDownAt: true,
        payerExternalName: true,
        payerEventPlayer: { select: { name: true, userId: true } },
      },
    });
    payerName = game && !game.payerStoodDownAt
      ? (game.payerEventPlayer?.name ?? game.payerExternalName ?? null)
      : null;
    if (payerName) {
      const resolved = await resolvePaymentDetails(event.id, event.currentGameId);
      resolvedPaymentMethods = resolved.methods;
      paymentSource = resolved.source;
    }
    viewerIsPayer = Boolean(
      userId && payerName && game?.payerEventPlayer?.userId === userId && !game?.payerStoodDownAt,
    );
  }

  return Response.json({
    ...eventCost,
    hasOverride,
    maxPlayers: event.maxPlayers,
    effectivePaymentMethods: effectivePaymentMethodsRaw(eventCost.tempPaymentMethods, eventCost.paymentMethods),
    resolvedPaymentMethods,
    payerName,
    paymentSource,
    viewerIsPayer,
    effectivePaymentDetails: eventCost.tempPaymentDetails ?? eventCost.paymentDetails ?? null,
    createdAt: eventCost.createdAt.toISOString(),
    updatedAt: eventCost.updatedAt.toISOString(),
    payments: eventCost.payments.map((p) => ({
      ...p,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    summary: {
      paidCount,
      totalCount: eventCost.payments.length,
      paidAmount,
    },
  });
};

/** DELETE — remove event cost and all payments. */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const existing = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!existing) return Response.json({ error: "No cost set." }, { status: 404 });

  await prisma.eventCost.delete({ where: { id: existing.id } });


  return Response.json({ ok: true });
};
