import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { authenticateRequest } from "~/lib/authenticate.server";
import { getSession } from "~/lib/auth.helpers.server";

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
    select: { id: true, currentGameId: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });
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
    prisma.eventPlayer.findFirst({ where: { eventId, userId }, select: { id: true } }),
  ]);

  if (!game) {
    return Response.json({ gameId: null, mode: "tracked", hasCost: false, payerName: null, isPayer: false, isRosterPlayer: false, vacant: false });
  }

  const vacant = Boolean(game.payerStoodDownAt);
  const payerName = game.payerEventPlayer?.name ?? game.payerExternalName ?? null;

  return Response.json({
    gameId: game.id,
    mode: game.paymentMode === "untracked" ? "untracked" : "tracked",
    hasCost: (cost?.totalAmount ?? 0) > 0,
    payerName,
    isPayer: !vacant && Boolean(payerName) && game.payerEventPlayer?.userId === userId,
    isRosterPlayer: Boolean(me),
    vacant,
  });
};
