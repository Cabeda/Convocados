import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { checkOwnership, getSession } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { validatePaymentMethods, normalizePaymentMethod } from "../../../../../lib/paymentMethods";
import type { PaymentMethod } from "../../../../../lib/paymentMethods";
import { logEvent } from "../../../../../lib/eventLog.server";

/**
 * Returns true if the user is an active participant in the event's current game.
 * Used to allow players to propose a one-off payment method for the current game.
 */
async function isActiveParticipant(eventId: string, userId: string): Promise<boolean> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { currentGameId: true },
  });
  if (!event?.currentGameId) return false;
  const participant = await prisma.gameParticipant.findFirst({
    where: {
      gameId: event.currentGameId,
      archivedAt: null,
      eventPlayer: { userId },
    },
  });
  return participant !== null;
}

/** PUT — set temporary payment method override for the current game.
 *
 * Authorization:
 *   - Owner / Admin: always allowed.
 *   - Active game participant: allowed for one-off override only.
 *     The client must NOT send setAsDefault=true for non-admin callers
 *     (the server enforces this).
 */
export const PUT: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request).catch(() => null);
  const userId = session?.user?.id ?? null;

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  const isPrivileged = isOwner || isAdmin;

  // Allow active participants for one-off overrides
  const participantAllowed = userId && !isPrivileged
    ? await isActiveParticipant(eventId, userId)
    : false;

  if (!isPrivileged && event.ownerId) {
    // Event has an owner — require participation at minimum
    if (!participantAllowed) {
      return Response.json({ error: "Only event participants can do this." }, { status: 403 });
    }
  }

  const existing = await prisma.eventCost.findUnique({ where: { eventId } });
  if (!existing) return Response.json({ error: "No cost set." }, { status: 404 });

  const body = await request.json();

  // setAsDefault is only honoured for owner/admin
  const setAsDefault = isPrivileged && Boolean(body.setAsDefault);

  // Validate and normalize payment methods
  let paymentMethodsJson: string | null = null;
  if (body.paymentMethods !== undefined && body.paymentMethods !== null) {
    if (Array.isArray(body.paymentMethods) && body.paymentMethods.length === 0) {
      paymentMethodsJson = null;
    } else {
      const err = validatePaymentMethods(body.paymentMethods);
      if (err) return Response.json({ error: err }, { status: 400 });
      const normalized = (body.paymentMethods as PaymentMethod[]).map(normalizePaymentMethod);
      paymentMethodsJson = JSON.stringify(normalized);
    }
  }

  const paymentDetails = body.paymentDetails !== null && body.paymentDetails !== undefined
    ? String(body.paymentDetails).trim().slice(0, 500) || null
    : null;

  // Optimistic lock: only update if the EventCost row hasn't been modified
  // since we read it (e.g. by a concurrent recurrence reset clearing temp fields).
  // NOTE(postgres): Replace with SELECT ... FOR UPDATE when migrating to Postgres (#236).
  const updateData = setAsDefault
    ? {
        paymentMethods: paymentMethodsJson,
        tempPaymentMethods: null, // clear temp when setting as default
        tempPaymentDetails: null,
      }
    : {
        tempPaymentMethods: paymentMethodsJson,
        tempPaymentDetails: paymentDetails,
      };

  const result = await prisma.eventCost.updateMany({
    where: { id: existing.id, updatedAt: existing.updatedAt },
    data: updateData,
  });

  if (result.count === 0) {
    return Response.json({ error: "Conflict — the event was just reset. Please try again." }, { status: 409 });
  }

  const logAction = setAsDefault ? "payment_methods_updated" : "override_set";
  logEvent(eventId, logAction, session?.user?.name ?? null, userId, {}).catch(() => {});

  return Response.json({ ok: true, setAsDefault });
};

/** DELETE — clear temporary payment method override, reverting to defaults. */
export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
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
    data: { tempPaymentMethods: null, tempPaymentDetails: null },
  });

  if (result.count === 0) {
    return Response.json({ error: "Conflict — the event was just reset. Please try again." }, { status: 409 });
  }

  const session = await getSession(request).catch(() => null);
  logEvent(eventId, "override_cleared", session?.user?.name ?? null, session?.user?.id ?? null, {}).catch(() => {});

  return Response.json({ ok: true });
};
