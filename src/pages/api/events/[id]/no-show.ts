/**
 * POST /api/events/[id]/no-show — Mark a player as no-show for a specific game.
 * ADR 0018: Hidden in game history UI, fires notification to the player.
 *
 * Body: { gameId: string, eventPlayerId: string, noShow: boolean }
 */
import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { checkOwnership } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { sendPushToUser } from "../../../../lib/push.server";
import { getNotificationPrefs } from "../../../../lib/notificationPrefs.server";

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { ownerId: true, title: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const { isOwner, isAdmin } = await checkOwnership(request, event.ownerId, undefined, eventId);
  if (!isOwner && !isAdmin) {
    return Response.json({ error: "Only owner/admin can mark no-shows." }, { status: 403 });
  }

  const body = await request.json();
  const { gameId, eventPlayerId, noShow } = body as { gameId?: string; eventPlayerId?: string; noShow?: boolean };

  if (!gameId || !eventPlayerId || typeof noShow !== "boolean") {
    return Response.json({ error: "gameId, eventPlayerId, and noShow (boolean) required." }, { status: 400 });
  }

  const participant = await prisma.gameParticipant.findUnique({
    where: { gameId_eventPlayerId: { gameId, eventPlayerId } },
    include: { eventPlayer: { select: { userId: true, name: true } } },
  });
  if (!participant) {
    return Response.json({ error: "Participant not found." }, { status: 404 });
  }

  await prisma.gameParticipant.update({
    where: { id: participant.id },
    data: { noShow },
  });

  // If marking as no-show (not unmarking), notify the player and update priority
  if (noShow && participant.eventPlayer.userId) {
    const userId = participant.eventPlayer.userId;

    // Update noShowStreak on PriorityEnrollment if it exists
    await prisma.priorityEnrollment.updateMany({
      where: { eventId, userId },
      data: { noShowStreak: { increment: 1 } },
    }).catch(() => {});

    // Notify the player
    const prefs = await getNotificationPrefs(userId);
    if (prefs.pushEnabled) {
      // Get current streak
      const enrollment = await prisma.priorityEnrollment.findUnique({
        where: { eventId_userId: { eventId, userId } },
        select: { noShowStreak: true },
      });
      const streak = enrollment?.noShowStreak ?? 1;
      const body = `You missed ${event.title}. No-show streak: ${streak}.${streak >= 2 ? " Priority may be affected." : ""}`;
      await sendPushToUser(userId, event.title, body, `/events/${eventId}`).catch(() => {});
    }
  }

  // If unmarking (noShow=false), decrement streak
  if (!noShow && participant.eventPlayer.userId) {
    await prisma.priorityEnrollment.updateMany({
      where: { eventId, userId: participant.eventPlayer.userId, noShowStreak: { gt: 0 } },
      data: { noShowStreak: { decrement: 1 } },
    }).catch(() => {});
  }

  return Response.json({ ok: true, noShow });
};
