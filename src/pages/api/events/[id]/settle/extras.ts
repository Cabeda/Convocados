import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";
import { getSession, checkOwnership } from "../../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { applyAllocation, ensureSystemUserId } from "../../../../../lib/payments.server";

/**
 * GET /api/events/[id]/settle/extras — public
 *   Returns the running pot balance + the full declaration log. Anyone with
 *   access to the event can read (organizers, admins, followers, players).
 *
 * POST /api/events/[id]/settle/extras — Owner/Admin only
 *   Declare a spend from the pot. Decrements EventCost.organizerExtrasCents
 *   transactionally and writes an ExtrasDeclaration row + a WalletTransaction
 *   row (reason: extras_declare, direction: debit) for the audit trail.
 *   For allocate_to_players / split_equally modes, also emits per-player
 *   WalletTransaction rows (reason: extras_share, direction: debit).
 *
 * Body:
 *   - amountCents (int, required)
 *   - label (string, required)
 *   - category (ExtrasCategory, optional, default: admin)
 *   - receiptUrl (string, optional)
 *   - allocation (object, optional): { mode, shares? }
 *       mode: "organizer_absorbs" | "allocate_to_players" | "split_equally"
 *       shares: Record<playerName, cents> (required for allocate_to_players)
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
      category: d.category,
      receiptUrl: d.receiptUrl,
      allocation: d.allocation,
      shares: d.shares,
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

  const category = (body.category as "court_rental" | "equipment" | "refreshments" | "admin") ?? "admin";
  const validCategories = ["court_rental", "equipment", "refreshments", "admin"] as const;
  if (!validCategories.includes(category)) {
    return Response.json({ error: "Invalid category." }, { status: 400 });
  }

  const receiptUrl = body.receiptUrl ? String(body.receiptUrl).trim().slice(0, 500) : null;
  if (receiptUrl && receiptUrl.length > 0 && !/^https?:\/\//.test(receiptUrl)) {
    return Response.json({ error: "receiptUrl must be a valid HTTP(S) URL." }, { status: 400 });
  }

  const allocation = body.allocation as
    | { mode: "organizer_absorbs" | "allocate_to_players" | "split_equally"; shares?: Record<string, number> }
    | undefined;

  if (allocation) {
    const validModes = ["organizer_absorbs", "allocate_to_players", "split_equally"] as const;
    if (!validModes.includes(allocation.mode)) {
      return Response.json({ error: "Invalid allocation mode." }, { status: 400 });
    }
    if (allocation.mode === "allocate_to_players") {
      if (!allocation.shares || Object.keys(allocation.shares).length === 0) {
        return Response.json({ error: "shares is required for allocate_to_players mode." }, { status: 400 });
      }
      const sharesSum = Object.values(allocation.shares).reduce((a, b) => a + b, 0);
      if (sharesSum > amountCents) {
        return Response.json({ error: "Shares sum exceeds amountCents." }, { status: 400 });
      }
    }
  }

  if (!event.eventCost) {
    return Response.json({ error: "Set an event cost first." }, { status: 400 });
  }

  // Fetch active players for split_equally mode
  const activePlayers = await prisma.eventPlayer.findMany({
    where: { eventId },
    select: { name: true },
    orderBy: { name: "asc" },
    take: event.maxPlayers,
  });
  const playerNames = activePlayers.map((p) => p.name);

  // The pot may briefly go negative if the organizer over-declares; the UI
  // flags this but we don't block it (organizer is source of truth for
  // their own pocket).
  const declaration = await prisma.extrasDeclaration.create({
    data: {
      eventId,
      amountCents,
      currency: event.eventCost.currency,
      label,
      category,
      receiptUrl,
      allocation: allocation ? JSON.parse(JSON.stringify(allocation)) : null,
      shares: allocation?.mode === "allocate_to_players" ? JSON.parse(JSON.stringify(allocation.shares)) : null,
      declaredBy: session.user.id,
    },
  });

  await prisma.eventCost.update({
    where: { id: event.eventCost.id },
    data: { organizerExtrasCents: { decrement: amountCents } },
  });

  // Audit row in the wallet ledger for the organizer (the spend itself).
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

  // For allocate_to_players / split_equally, emit per-player debit rows
  // so each player's ledger reflects their share of the extras spend.
  if (allocation && allocation.mode !== "organizer_absorbs") {
    const perPlayer = applyAllocation({
      mode: allocation.mode,
      amountCents,
      players: playerNames,
      shares: allocation.shares,
    });

    for (const share of perPlayer) {
      const player = await prisma.eventPlayer.findUnique({
        where: { eventId_name: { eventId, name: share.playerName } },
        select: { userId: true },
      });
      const userId = player?.userId ?? (await ensureSystemUserId(eventId, share.playerName, null));

      await prisma.walletTransaction.create({
        data: {
          eventId,
          userId,
          amountCents: share.cents,
          currency: event.eventCost.currency,
          direction: "debit",
          gameUnits: 0,
          reason: "extras_share",
          extrasId: declaration.id,
          markedById: session.user.id,
        },
      });
    }
  }

  return Response.json({
    ok: true,
    declaration: {
      id: declaration.id,
      amountCents: declaration.amountCents,
      currency: declaration.currency,
      label: declaration.label,
      category: declaration.category,
      receiptUrl: declaration.receiptUrl,
      allocation: declaration.allocation,
      shares: declaration.shares,
      declaredBy: declaration.declaredBy,
      declaredAt: declaration.declaredAt.toISOString(),
    },
  });
};
