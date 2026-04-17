import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

const VALID_STATUSES = ["pending", "paid"];

/** GET — list all payments with summary. */
export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const eventCost = await prisma.eventCost.findUnique({
    where: { eventId },
    include: { payments: { orderBy: { playerName: "asc" } } },
  });

  if (!eventCost) {
    return Response.json({
      payments: [],
      summary: { paidCount: 0, pendingCount: 0, totalCount: 0, paidAmount: 0 },
    });
  }

  const payments = eventCost.payments;
  const paidCount = payments.filter((p) => p.status === "paid").length;
  const pendingCount = payments.filter((p) => p.status === "pending").length;
  const paidAmount = payments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amount, 0);

  return Response.json({
    payments: payments.map((p) => ({
      ...p,
      paidAt: p.paidAt?.toISOString() ?? null,
      createdAt: p.createdAt.toISOString(),
      updatedAt: p.updatedAt.toISOString(),
    })),
    summary: {
      paidCount,
      pendingCount,
      totalCount: payments.length,
      paidAmount,
    },
  });
};

/** PUT — update a player's payment status. */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const eventCost = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!eventCost) return Response.json({ error: "No cost set for this event." }, { status: 404 });

  const body = await request.json();
  const playerName = String(body.playerName ?? "").trim();
  const status = String(body.status ?? "");
  const method = body.method !== null ? String(body.method).trim().slice(0, 50) || null : undefined;

  if (!VALID_STATUSES.includes(status)) {
    return Response.json({ error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` }, { status: 400 });
  }

  const payment = await prisma.playerPayment.findUnique({
    where: { eventCostId_playerName: { eventCostId: eventCost.id, playerName } },
  });
  if (!payment) return Response.json({ error: "Player payment not found." }, { status: 404 });

  const updated = await prisma.playerPayment.update({
    where: { id: payment.id },
    data: {
      status,
      paidAt: status === "paid" ? new Date() : null,
      ...(method !== undefined && { method }),
    },
  });


  return Response.json({
    ...updated,
    paidAt: updated.paidAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
    updatedAt: updated.updatedAt.toISOString(),
  });
};
