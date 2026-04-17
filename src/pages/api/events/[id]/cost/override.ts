import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { checkOwnership, getSession } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { validatePaymentMethods, normalizePaymentMethod } from "../../../../../lib/paymentMethods";
import type { PaymentMethod } from "../../../../../lib/paymentMethods";
import { logEvent } from "../../../../../lib/eventLog.server";

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

  const tempPaymentDetails = body.paymentDetails !== null && body.paymentDetails !== undefined
    ? String(body.paymentDetails).trim().slice(0, 500) || null
    : null;

  // Optimistic lock: only update if the EventCost row hasn't been modified
  // since we read it (e.g. by a concurrent recurrence reset clearing temp fields).
  // On SQLite this is redundant (serialized writes), but future-proofs for Postgres
  // where the reset $transaction and this update can race.
  // NOTE(postgres): Replace with SELECT ... FOR UPDATE when migrating to Postgres (#236).
  const result = await prisma.eventCost.updateMany({
    where: { id: existing.id, updatedAt: existing.updatedAt },
    data: {
      tempPaymentMethods: tempPaymentMethodsJson,
      tempPaymentDetails: tempPaymentDetails,
    },
  });

  if (result.count === 0) {
    return Response.json({ error: "Conflict — the event was just reset. Please try again." }, { status: 409 });
  }

  const session = await getSession(request).catch(() => null);
  logEvent(eventId, "override_set", session?.user?.name ?? null, session?.user?.id ?? null, {}).catch(() => {});

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

  // Optimistic lock — same rationale as PUT above.
  const result = await prisma.eventCost.updateMany({
    where: { id: existing.id, updatedAt: existing.updatedAt },
    data: {
      tempPaymentMethods: null,
      tempPaymentDetails: null,
    },
  });

  if (result.count === 0) {
    return Response.json({ error: "Conflict — the event was just reset. Please try again." }, { status: 409 });
  }

  const session = await getSession(request).catch(() => null);
  logEvent(eventId, "override_cleared", session?.user?.name ?? null, session?.user?.id ?? null, {}).catch(() => {});

  return Response.json({ ok: true });
};
