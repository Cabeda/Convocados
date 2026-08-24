import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession, checkEventAdmin } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { createPlayerInvite, retractPlayerInvite, expirePendingInvites, resendPlayerInvite, InviteResendCooldownError } from "~/lib/invite.server";
import { getNotificationPrefs, wantsInvites } from "~/lib/notificationPrefs.server";

/**
 * ADR 0025 — PlayerInvite management (owner/admin).
 *
 * GET    /api/events/[id]/invites       — list invites for the current game
 * POST   /api/events/[id]/invites       — create an invite: { userId }
 * PATCH  /api/events/[id]/invites       — resend a pending invite: { inviteId }
 * DELETE /api/events/[id]/invites       — retract: { inviteId }
 */
/**
 * ADR 0025: who may send invites on an event — the owner, any admin, or any
 * player who has played in the event (an EventPlayer with at least one
 * GameParticipant across the event's games).
 */
async function canInviteOnEvent(eventId: string, userId: string): Promise<boolean> {
  const [isAdmin, event] = await Promise.all([
    checkEventAdmin(eventId, userId),
    prisma.event.findUnique({ where: { id: eventId }, select: { ownerId: true } }),
  ]);
  if (isAdmin) return true;
  if (event?.ownerId === userId) return true;
  const played = await prisma.eventPlayer.findFirst({
    where: { eventId, userId, participations: { some: {} } },
    select: { id: true },
  });
  return !!played;
}

export const GET: APIRoute = async ({ params, request }) => {
  const eventId = params.id ?? "";
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!(await canInviteOnEvent(eventId, session.user.id))) {
    return Response.json({ error: "Only the owner, an admin, or a player of this event can manage invites." }, { status: 403 });
  }

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { currentGameId: true } });
  if (!event?.currentGameId) return Response.json({ invites: [] });

  await expirePendingInvites(event.currentGameId);
  const invites = await prisma.playerInvite.findMany({
    where: { gameId: event.currentGameId },
    include: {
      eventPlayer: { select: { id: true, name: true, userId: true } },
      invitedBy: { select: { name: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  // EventPlayer has no image; resolve it from the linked User, like the event
  // roster does. Guests (no userId) have no image.
  const userIds = [...new Set(invites.map((i) => i.eventPlayer.userId).filter((u): u is string => !!u))];
  const users = userIds.length
    ? await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, image: true } })
    : [];
  const imageByUserId = new Map(users.map((u) => [u.id, u.image]));

  return Response.json({
    invites: invites.map((i) => ({
      ...i,
      eventPlayer: {
        ...i.eventPlayer,
        image: i.eventPlayer.userId ? (imageByUserId.get(i.eventPlayer.userId) ?? null) : null,
      },
    })),
  });
};

/** Preconditions for inviting a user. Returns an error string or null. */
async function inviteBlockReason(eventId: string, gameId: string, inviteeUserId: string): Promise<string | null> {
  const [prefs, ep, participant, pending, rsvpNo, noShow] = await Promise.all([
    getNotificationPrefs(inviteeUserId),
    prisma.eventPlayer.findFirst({ where: { eventId, userId: inviteeUserId } }),
    prisma.gameParticipant.findFirst({
      where: { gameId, eventPlayer: { userId: inviteeUserId }, archivedAt: null, status: { not: "pending" } },
      select: { id: true },
    }),
    prisma.playerInvite.findFirst({
      where: { gameId, eventPlayer: { userId: inviteeUserId }, status: "pending" },
      select: { id: true },
    }),
    prisma.rsvp.findFirst({
      where: { gameId, eventPlayer: { userId: inviteeUserId }, status: "no" },
      select: { id: true },
    }),
    prisma.priorityEnrollment.findFirst({
      where: { eventId, userId: inviteeUserId },
      select: { noShowStreak: true },
    }),
  ]);

  if (!wantsInvites(prefs)) return "This user has turned off game invites.";
  if (ep?.invitationOptOutAt) return "This user opted out of invites for this event.";
  if (participant) return "This user is already on the player list.";
  if (pending) return "This user already has a pending invite.";
  if (rsvpNo) return "This user declined this game.";
  if ((noShow?.noShowStreak ?? 0) >= 2) return "This user has missed the last two games.";

  return null;
}

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });
  if (!(await canInviteOnEvent(eventId, session.user.id))) {
    return Response.json({ error: "Only the owner, an admin, or a player of this event can send invites." }, { status: 403 });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { currentGameId: true, dateTime: true },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });
  if (!event.currentGameId) return Response.json({ error: "This event has no current game." }, { status: 400 });
  if (event.dateTime <= new Date()) return Response.json({ error: "This game has already started." }, { status: 400 });

  let body: { userId?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.userId !== "string") {
    return Response.json({ error: "userId is required." }, { status: 400 });
  }

  const reason = await inviteBlockReason(eventId, event.currentGameId, body.userId);
  if (reason) return Response.json({ error: reason }, { status: 409 });

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  try {
    const result = await createPlayerInvite({
      eventId,
      gameId: event.currentGameId,
      inviteeUserId: body.userId,
      invitedByUserId: session.user.id,
      origin,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to create invite.";
    return Response.json({ error: message }, { status: 400 });
  }
};

/**
 * Resend a pending invite (owner, admin, or the original inviter). Enforces a
 * 24h cooldown since the last delivery — 429 with retryAfterSeconds while the
 * invite was sent too recently.
 */
export const PATCH: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  let body: { inviteId?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.inviteId !== "string") {
    return Response.json({ error: "inviteId is required." }, { status: 400 });
  }

  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.cabeda.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const origin = `${proto}://${host}`;

  try {
    const result = await resendPlayerInvite({
      eventId,
      inviteId: body.inviteId,
      requestedByUserId: session.user.id,
      origin,
    });
    return Response.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof InviteResendCooldownError) {
      return Response.json(
        { error: err.message, retryAfterSeconds: err.retryAfterSeconds },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } },
      );
    }
    const message = err instanceof Error ? err.message : "Failed to resend invite.";
    if (message.includes("Only the owner")) return Response.json({ error: message }, { status: 403 });
    if (message.includes("no longer pending")) return Response.json({ error: message }, { status: 409 });
    return Response.json({ error: message }, { status: 400 });
  }
};

export const DELETE: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  let body: { inviteId?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (typeof body.inviteId !== "string") {
    return Response.json({ error: "inviteId is required." }, { status: 400 });
  }

  try {
    await retractPlayerInvite({ inviteId: body.inviteId, userId: session.user.id, eventId });
    return Response.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to retract invite.";
    const status = message.includes("Only the owner") ? 403 : 400;
    return Response.json({ error: message }, { status });
  }
};