import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { authenticateRequest } from "~/lib/authenticate.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { authorizeEventMutation } from "~/lib/eventAuthz.server";

/**
 * POST /api/events/[id]/payments/payer/stand-down
 *
 * The Payer withdraws for one Game (ADR 0055). The id stays — so the Owner knows
 * who to ask back — and `payerStoodDownAt` marks the role Vacant, which lets any
 * roster player claim it without pretending nobody was ever expected to pay.
 *
 * Body: { gameId? } — defaults to the Event's current Game.
 */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const authCtx = await authenticateRequest(request);
  const userId = authCtx?.userId ?? (await getSession(request))?.user?.id ?? null;
  if (!userId) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, currentGameId: true, ownerId: true, isPublic: true, accessPassword: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  let body: { gameId?: unknown } = {};
  try {
    body = await request.json();
  } catch {
    // An empty body is fine: the current Game is the default.
  }
  const gameId = typeof body.gameId === "string" ? body.gameId : event.currentGameId;
  if (!gameId) return Response.json({ error: "No active game." }, { status: 400 });

  const game = await prisma.game.findUnique({
    where: { id: gameId },
    select: {
      id: true,
      eventId: true,
      payerEventPlayerId: true,
      payerStoodDownAt: true,
      payerEventPlayer: { select: { userId: true } },
    },
  });
  if (!game || game.eventId !== eventId) {
    return Response.json({ error: "Game not found." }, { status: 404 });
  }
  if (!game.payerEventPlayerId) {
    return Response.json({ error: "This game has no payer to stand down." }, { status: 400 });
  }

  const isPayer = game.payerEventPlayer?.userId === userId;
  if (!isPayer) {
    const authz = await authorizeEventMutation(request, event);
    if (!authz.allowed) {
      return Response.json({ error: "Only the payer or an organizer can do this." }, { status: 403 });
    }
  }

  await prisma.game.update({
    where: { id: gameId },
    data: { payerStoodDownAt: game.payerStoodDownAt ?? new Date() },
  });

  return Response.json({ ok: true, gameId, vacant: true });
};
