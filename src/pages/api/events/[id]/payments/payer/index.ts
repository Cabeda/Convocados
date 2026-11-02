import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { authenticateRequest } from "~/lib/authenticate.server";
import { getSession } from "~/lib/auth.helpers.server";
import { checkAccess } from "~/lib/eventAccess";
import { canReadEventFinances } from "~/lib/eventReadAccess.server";
import { checkEventAdmin } from "~/lib/auth.helpers.server";
import { activeParticipantsWhere } from "~/lib/activeParticipants.server";

/**
 * GET /api/events/[id]/payments/payer
 *
 * Who is collecting for the current Game, and what the viewer may do about it
 * (ADR 0055). Deliberately small: the payments screen does not need the whole
 * settlement roll to render one name and two buttons.
 */
export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id ?? null;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, currentGameId: true, ownerId: true, isPublic: true, accessPassword: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // Mirror the page gate: an Event admin or invitee is admitted without the
  // password cookie (GET /events/[id] never asks them for it).
  const [isAdmin, isInvited] = await Promise.all([
    checkEventAdmin(eventId, userId),
    prisma.eventInvite.count({ where: { eventId, userId } }).then((count) => count > 0),
  ]);
  const access = checkAccess({
    eventOwnerId: event.ownerId,
    accessPassword: event.accessPassword,
    requestUserId: userId,
    cookieHeader: request.headers.get("cookie"),
    eventId: event.id,
    isInvited: isInvited || isAdmin,
  });
  if (!access.granted) {
    return Response.json({ locked: true, error: "This event is locked." }, { status: 403 });
  }
  if (!(await canReadEventFinances(request, event))) {
    return Response.json({ error: "You cannot read this event's payments." }, { status: 403 });
  }
  if (!event.currentGameId) {
    return Response.json({ gameId: null, mode: "tracked", hasCost: false, payerName: null, isPayer: false, isRosterPlayer: false, vacant: false });
  }

  const [game, cost, me] = await Promise.all([
    prisma.game.findUnique({
      where: { id: event.currentGameId },
      select: {
        id: true,
        paymentMode: true,
        payerStoodDownAt: true,
        payerExternalName: true,
        payerEventPlayer: { select: { name: true, userId: true } },
      },
    }),
    prisma.eventCost.findUnique({ where: { eventId }, select: { totalAmount: true } }),
    prisma.gameParticipant.findFirst({
      where: { ...activeParticipantsWhere(event.currentGameId), eventPlayer: { eventId, userId } },
      select: { id: true },
    }),
  ]);

  if (!game) {
    return Response.json({ gameId: null, mode: "tracked", hasCost: false, payerName: null, isPayer: false, isRosterPlayer: false, vacant: false });
  }

  const vacant = Boolean(game.payerStoodDownAt);
  const payerName = game.payerEventPlayer?.name ?? game.payerExternalName ?? null;
  const canClaim = Boolean(me);

  return Response.json({
    gameId: game.id,
    mode: game.paymentMode === "untracked" ? "untracked" : "tracked",
    hasCost: (cost?.totalAmount ?? 0) > 0,
    payerName,
    isPayer: !vacant && Boolean(payerName) && game.payerEventPlayer?.userId === userId,
    isRosterPlayer: canClaim,
    canClaim,
    vacant,
  });
};
