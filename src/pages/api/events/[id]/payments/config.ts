import type { APIRoute } from "astro";
import { prisma } from "../../../../../lib/db.server";

import { authorizeEventMutation } from "../../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../../lib/apiRateLimit.server";
import { setPaymentConfig } from "../../../../../lib/settlement.server";

/**
 * PATCH /api/events/[id]/payments/config
 * Owner/admin sets a game's payment mode + payer.
 * Body: { gameId?, mode: "tracked"|"untracked", payerEventPlayerId?, payerExternalName?, saveAsDefault? }
 * gameId defaults to the event's current game. `saveAsDefault` also persists the
 * chosen payer as the Event's default for new Games (owner only).
 */
export const PATCH: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) {
    return Response.json({ error: "Only the event owner can do this." }, { status: 403 });
  }

  const body = await request.json();
  const mode = body.mode === "untracked" ? "untracked" : "tracked";
  const gameId = typeof body.gameId === "string" ? body.gameId : event.currentGameId;
  if (!gameId) {
    return Response.json({ error: "No active game to configure." }, { status: 400 });
  }

  // The Event default is Event-level configuration, so only the owner — not an
  // admin or a share-link visitor — may write it.
  const saveAsDefault = body.saveAsDefault === true;
  if (saveAsDefault && !authz.isOwner) {
    return Response.json({ error: "Only the event owner can save a default payer." }, { status: 403 });
  }

  const payerEventPlayerId = typeof body.payerEventPlayerId === "string" ? body.payerEventPlayerId : undefined;
  const payerExternalName = typeof body.payerExternalName === "string" ? body.payerExternalName : undefined;

  try {
    await setPaymentConfig(eventId, gameId, {
      mode,
      payerEventPlayerId,
      payerExternalName,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid payment config.";
    return Response.json({ error: message }, { status: 400 });
  }

  if (saveAsDefault) {
    await prisma.event.update({
      where: { id: eventId },
      data: {
        // An untracked Game has no payer, so asking to remember it clears the
        // default instead of leaving a stale collector behind.
        defaultPayerEventPlayerId: mode === "tracked" ? payerEventPlayerId || null : null,
        defaultPayerExternalName: mode === "tracked" ? payerExternalName?.trim() || null : null,
      },
    });
  }

  return Response.json({ ok: true, gameId, mode });
};
