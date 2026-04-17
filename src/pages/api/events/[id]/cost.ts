import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { validatePaymentMethods, normalizePaymentMethod } from "../../../../lib/paymentMethods";
import type { PaymentMethod } from "../../../../lib/paymentMethods";

/** PUT — set or update event cost. Creates/recalculates player payment records. */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { orderBy: { order: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const totalAmount = Number(body.totalAmount);
  if (!totalAmount || totalAmount <= 0) {
    return Response.json({ error: "totalAmount must be a positive number." }, { status: 400 });
  }
  const currency = String(body.currency ?? "EUR").trim().slice(0, 10) || "EUR";
  const paymentDetails = body.paymentDetails !== null && body.paymentDetails !== undefined
    ? String(body.paymentDetails).trim().slice(0, 500) || null
    : undefined;

  // Validate structured payment methods (if provided)
  let paymentMethodsJson: string | undefined;
  if (body.paymentMethods !== undefined) {
    if (body.paymentMethods === null || (Array.isArray(body.paymentMethods) && body.paymentMethods.length === 0)) {
      paymentMethodsJson = null as unknown as string;
    } else {
      const err = validatePaymentMethods(body.paymentMethods);
      if (err) return Response.json({ error: err }, { status: 400 });
      const normalized = (body.paymentMethods as PaymentMethod[]).map(normalizePaymentMethod);
      paymentMethodsJson = JSON.stringify(normalized);
    }
  }

  // Active players only (not bench)
  const activePlayers = event.players.slice(0, event.maxPlayers);
  const share = activePlayers.length > 0 ? totalAmount / activePlayers.length : 0;

  // Upsert EventCost
  const existing = await prisma.eventCost.findUnique({ where: { eventId } });

  let eventCost;
  if (existing) {
    eventCost = await prisma.eventCost.update({
      where: { id: existing.id },
      data: {
        totalAmount,
        currency,
        ...(paymentDetails !== undefined && { paymentDetails }),
        ...(paymentMethodsJson !== undefined && { paymentMethods: paymentMethodsJson }),
      },
    });
  } else {
    eventCost = await prisma.eventCost.create({
      data: {
        eventId,
        totalAmount,
        currency,
        paymentDetails: paymentDetails ?? null,
        paymentMethods: paymentMethodsJson ?? null,
      },
    });
  }

  // Upsert PlayerPayment for each active player
  for (const player of activePlayers) {
    await prisma.playerPayment.upsert({
      where: {
        eventCostId_playerName: { eventCostId: eventCost.id, playerName: player.name },
      },
      create: {
        eventCostId: eventCost.id,
        playerName: player.name,
        amount: share,
      },
      update: {
        amount: share,
      },
    });
  }

  // Remove payments for players no longer active
  const activeNames = new Set(activePlayers.map((p) => p.name));
  await prisma.playerPayment.deleteMany({
    where: {
      eventCostId: eventCost.id,
      playerName: { notIn: [...activeNames] },
    },
  });

  const payments = await prisma.playerPayment.findMany({
    where: { eventCostId: eventCost.id },
    orderBy: { playerName: "asc" },
  });


  return Response.json({
    ...eventCost,
    createdAt: eventCost.createdAt.toISOString(),
    updatedAt: eventCost.updatedAt.toISOString(),
    payments: payments.map((p) => ({
      ...p,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
  });
};

/** GET — get event cost with payments and summary. */
export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const eventCost = await prisma.eventCost.findUnique({
    where: { eventId },
    include: { payments: { orderBy: { playerName: "asc" } } },
  });

  if (!eventCost) return Response.json(null);

  const paidCount = eventCost.payments.filter((p) => p.status === "paid").length;
  const paidAmount = eventCost.payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);

  const hasOverride = !!(eventCost.tempPaymentMethods || eventCost.tempPaymentDetails);

  return Response.json({
    ...eventCost,
    hasOverride,
    effectivePaymentMethods: eventCost.tempPaymentMethods ?? eventCost.paymentMethods ?? null,
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

  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const existing = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!existing) return Response.json({ error: "No cost set." }, { status: 404 });

  await prisma.eventCost.delete({ where: { id: existing.id } });


  return Response.json({ ok: true });
};
