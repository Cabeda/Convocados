/**
 * POST /api/events/[id]/no-show — Mark a player as no-show for a specific game.
 * ADR 0018: Hidden in game history UI, fires notification to the player.
 *
 * Body: { gameId: string, eventPlayerId: string, noShow: boolean }
 */
import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { authorizeEventMutation } from "../../../../lib/eventAuthz.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { sendPushToUser } from "../../../../lib/push.server";
import { getNotificationPrefs } from "../../../../lib/notificationPrefs.server";
import { applyNoShowTransition } from "../../../../lib/priority.server";

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { id: true, ownerId: true, isPublic: true, accessPassword: true, title: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const authz = await authorizeEventMutation(request, event);
  if (!authz.allowed) {
    return Response.json({ error: "Only owner/admin can mark no-shows." }, { status: 403 });
  }

  const body = await request.json();
  const { gameId, eventPlayerId, noShow } = body as { gameId?: string; eventPlayerId?: string; noShow?: boolean };

  if (!gameId || !eventPlayerId || typeof noShow !== "boolean") {
    return Response.json({ error: "gameId, eventPlayerId, and noShow (boolean) required." }, { status: 400 });
  }

  // Bind the supplied game to THIS event — otherwise owner/admin of event A
  // could mark no-shows on a game belonging to event B.
  const game = await prisma.game.findUnique({ where: { id: gameId }, select: { eventId: true } });
  if (!game || game.eventId !== eventId) {
    return Response.json({ error: "gameId does not belong to this event." }, { status: 400 });
  }

  const participant = await prisma.gameParticipant.findUnique({
    where: { gameId_eventPlayerId: { gameId, eventPlayerId } },
    include: { eventPlayer: { select: { userId: true, name: true } } },
  });
  if (!participant) {
    return Response.json({ error: "Participant not found." }, { status: 404 });
  }

  const userId = participant.eventPlayer.userId;
  const changed = await applyNoShowTransition({
    participantId: participant.id,
    eventId,
    userId,
    noShow,
  });

  // Notify only on a real false→true transition, so a retry cannot double-push.
  if (changed && noShow && userId) {
    const prefs = await getNotificationPrefs(userId);
    if (prefs.pushEnabled) {
      const enrollment = await prisma.priorityEnrollment.findUnique({
        where: { eventId_userId: { eventId, userId } },
        select: { noShowStreak: true },
      });
      const streak = enrollment?.noShowStreak ?? 1;
      const body = `You missed ${event.title}. No-show streak: ${streak}.${streak >= 2 ? " Priority may be affected." : ""}`;
      await sendPushToUser(userId, event.title, body, `/events/${eventId}`).catch(() => {});
    }
  }

  return Response.json({ ok: true, noShow });
};
