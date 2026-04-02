import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { checkOwnership } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { validatePaymentMethods, normalizePaymentMethod } from "../../../../../lib/paymentMethods";
import type { PaymentMethod } from "../../../../../lib/paymentMethods";

/** PUT — set temporary payment method override for the current week. */
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

  const existing = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!existing) return Response.json({ error: "No cost set." }, { status: 404 });

  const body = await request.json();

  // Validate and normalize payment methods
  let tempPaymentMethodsJson: string | null = null;
  if (body.paymentMethods !== undefined && body.paymentMethods !== null) {
    if (Array.isArray(body.paymentMethods) && body.paymentMethods.length === 0) {
      tempPaymentMethodsJson = null;
    } else {
      const err = validatePaymentMethods(body.paymentMethods);
      if (err) return Response.json({ error: err }, { status: 400 });
      const normalized = (body.paymentMethods as PaymentMethod[]).map(normalizePaymentMethod);
      tempPaymentMethodsJson = JSON.stringify(normalized);
    }
  }

  const tempPaymentDetails = body.paymentDetails != null
    ? String(body.paymentDetails).trim().slice(0, 500) || null
    : null;

  await prisma.eventCost.update({
    where: { id: existing.id },
    data: {
      tempPaymentMethods: tempPaymentMethodsJson,
      tempPaymentDetails: tempPaymentDetails,
    },
  });

  return Response.json({ ok: true });
};

/** DELETE — clear temporary payment method override, reverting to defaults. */
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

  await prisma.eventCost.update({
    where: { id: existing.id },
    data: {
      tempPaymentMethods: null,
      tempPaymentDetails: null,
    },
  });

  return Response.json({ ok: true });
};
