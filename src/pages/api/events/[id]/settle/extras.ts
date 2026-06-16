import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";

/**
 * GET /api/events/[id]/settle/extras — public
 *   Returns the running pot balance + the full declaration log. Anyone with
 *   access to the event can read (organizers, admins, followers, players).
 *
 * POST /api/events/[id]/settle/extras — Owner/Admin only
 *   Declare a spend from the pot. Decrements EventCost.organizerExtrasCents
 *   transactionally and writes an ExtrasDeclaration row + a WalletTransaction
 *   row (reason: extras_declare, direction: debit) for the audit trail.
 */
export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { eventCost: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const declarations = await prisma.extrasDeclaration.findMany({
    where: { eventId },
    orderBy: { declaredAt: "desc" },
  });

  return Response.json({
    potCents: event.eventCost?.organizerExtrasCents ?? 0,
    currency: event.eventCost?.currency ?? "EUR",
    declarations: declarations.map((d) => ({
      id: d.id,
      amountCents: d.amountCents,
      currency: d.currency,
      label: d.label,
      declaredBy: d.declaredBy,
      declaredAt: d.declaredAt.toISOString(),
    })),
  });
};

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { eventCost: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const session = await getSession(request);
  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, session, eventId);
  if (event.ownerId && !isOwner && !isAdmin) {
    return Response.json({ error: "Only the event owner can declare extras." }, { status: 403 });
  }
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  const body = await request.json();
  const amountCents = Number(body.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    return Response.json({ error: "amountCents must be a positive integer." }, { status: 400 });
  }
  const label = String(body.label ?? "").trim().slice(0, 200);
  if (!label) return Response.json({ error: "label is required." }, { status: 400 });

  if (!event.eventCost) {
    return Response.json({ error: "Set an event cost first." }, { status: 400 });
  }

  // The pot may briefly go negative if the organizer over-declares; the UI
  // flags this but we don't block it (organizer is source of truth for
  // their own pocket).
  const declaration = await prisma.extrasDeclaration.create({
    data: {
      eventId,
      amountCents,
      currency: event.eventCost.currency,
      label,
      declaredBy: session.user.id,
    },
  });

  await prisma.eventCost.update({
    where: { id: event.eventCost.id },
    data: { organizerExtrasCents: { decrement: amountCents } },
  });

  // Audit row in the wallet ledger for the organizer.
  await prisma.walletTransaction.create({
    data: {
      eventId,
      userId: session.user.id,
      amountCents,
      currency: event.eventCost.currency,
      direction: "debit",
      gameUnits: 0,
      reason: "extras_declare",
      extrasId: declaration.id,
      markedById: session.user.id,
    },
  });

  return Response.json({
    ok: true,
    declaration: {
      id: declaration.id,
      amountCents: declaration.amountCents,
      currency: declaration.currency,
      label: declaration.label,
      declaredBy: declaration.declaredBy,
      declaredAt: declaration.declaredAt.toISOString(),
    },
  });
};
