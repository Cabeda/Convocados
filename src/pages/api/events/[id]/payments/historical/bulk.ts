import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { checkOwnership, getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { settleAllHistoricalForPlayer } from "~/lib/payments.server";

/**
 * POST /api/events/[id]/payments/historical/bulk
 *
 * Body:
 *   playerName    — the DEBTOR whose pending payments to settle (required)
 *   creditorName  — when set, the settlement is scoped to debts where this
 *                    user is the creditor. The caller must be the creditor
 *                    themselves, the event owner, or an admin. Required
 *                    for non-admin callers to settle anything.
 *   payerUserId   — override the debtor's userId (defaults to the debtor)
 *   paidToUserId  — override the creditor's userId (defaults to the event
 *                    owner if no creditorName is set, or the creditor's
 *                    userId when creditorName is set)
 *
 * Settles every pending/sent historical game for the player in one go.
 * Authorization: event owner/admin OR the creditor themselves.
 *
 * Why the creditor gate? A debtor could otherwise "settle" their own debt
 * by calling this endpoint, which would let any player self-clear money
 * they owe. The money flows from the debtor to the creditor, so only the
 * creditor (or the admin) should be the one confirming payment.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const body = await request.json();
  const playerName = String(body.playerName ?? "").trim();
  const creditorName = body.creditorName ? String(body.creditorName).trim() : null;
  if (!playerName) {
    return Response.json({ error: "playerName is required." }, { status: 400 });
  }

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  const session = await getSession(request).catch(() => null);
  const sessionUserId = session?.user?.id ?? null;

  // Authorize: owner/admin always allowed. When a creditorName is set,
  // the caller must also be that creditor (so the DEBTOR cannot mark
  // their own debt as paid).
  let authorized = isOwner || isAdmin;
  let creditorUserId: string | null = null;

  if (creditorName) {
    if (sessionUserId) {
      const callerEp = await prisma.eventPlayer.findFirst({
        where: { eventId, userId: sessionUserId },
        select: { name: true },
      });
      if (callerEp && callerEp.name.toLowerCase() === creditorName.toLowerCase()) {
        authorized = true;
      }
    }
    // Look up the creditor's userId for the paidToUserId field.
    const creditorEp = await prisma.eventPlayer.findFirst({
      where: { eventId, name: creditorName },
      select: { userId: true },
    });
    creditorUserId = creditorEp?.userId ?? null;

    if (!authorized) {
      return Response.json(
        { error: "Only the event owner or the creditor can mark this debt as settled." },
        { status: 403 },
      );
    }
  }

  // Legacy owner gate: when the event has an owner and the caller isn't
  // admin/owner, reject. (Superseded by the creditor gate above when a
  // creditorName is provided.) When the event has no owner and no
  // creditorName, anyone is allowed (legacy behavior).
  if (event.ownerId && !authorized) {
    return Response.json(
      { error: "Only the event owner or the creditor can mark this debt as settled." },
      { status: 403 },
    );
  }

  const markedById = sessionUserId ?? event.ownerId ?? "";

  // Resolve the payerUserId / paidToUserId for the settlement.
  // - payerUserId defaults to the debtor's userId (looked up from name).
  // - paidToUserId defaults to the event owner's userId, OR the creditor's
  //   userId when creditorName is set.
  const debtorEp = await prisma.eventPlayer.findFirst({
    where: { eventId, name: playerName },
    select: { userId: true },
  });
  const payerUserId = body.payerUserId
    ? String(body.payerUserId).trim()
    : (debtorEp?.userId ?? null);
  const paidToUserId = body.paidToUserId
    ? String(body.paidToUserId).trim()
    : (creditorUserId ?? null);

  const historical = await settleAllHistoricalForPlayer({
    eventId,
    playerName,
    markedById,
    payerUserId,
    paidToUserId,
  });

  // Live payments: the `PlayerPayment` rows on `EventCost` are the "next
  // game" or just-played game's pending payments. These are the "default"
  // payments that an event with no historical games still has. The
  // historical flow above only touches `paymentsSnapshot` (frozen past
  // games) so without this second step, freshly-played events show no
  // visible change when the user clicks "Mark settled".
  //
  // Live payments are paid to the event owner (the implicit creditor), so
  // only the owner / admin can confirm them — the creditor gate from the
  // historical flow doesn't extend here.
  let liveUpdated = 0;
  if (isOwner || isAdmin) {
    const eventCost = await prisma.eventCost.findUnique({
      where: { eventId },
      select: { id: true },
    });
    if (eventCost) {
      const live = await prisma.playerPayment.updateMany({
        where: {
          eventCostId: eventCost.id,
          playerName,
          status: { in: ["pending", "sent"] },
        },
        data: { status: "paid", paidAt: new Date() },
      });
      liveUpdated = live.count;
    }
  }

  const totalSettled = historical.settled + liveUpdated;
  return Response.json({
    ok: true,
    settled: totalSettled,
    skipped: historical.skipped,
    failed: historical.failed,
    historical: { settled: historical.settled, skipped: historical.skipped, failed: historical.failed },
    live: liveUpdated,
    details: historical.details,
  });
};
