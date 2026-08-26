import type { APIRoute } from "astro";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import { rateLimitResponse } from "~/lib/apiRateLimit.server";
import { expirePendingInvites, acceptPlayerInvite, declinePlayerInvite } from "~/lib/invite.server";
import { addPlayerToTeams, validateTeams } from "~/pages/api/events/[id]/players";
import { syncGamePayments } from "~/lib/settlement.server";

/**
 * ADR 0025 — invite-by-link.
 *
 * GET  /api/invite/[token] — public invite lookup (lazy-expires pending invites)
 * POST /api/invite/[token] — { action: "accept" | "decline" } (auth required)
 */
export const GET: APIRoute = async ({ params, request }) => {
  const token = params.token ?? "";
  const invite = await prisma.playerInvite.findUnique({
    where: { token },
    include: {
      invitedBy: { select: { name: true } },
      eventPlayer: {
        select: {
          name: true,
          userId: true,
          event: {
            select: { id: true, title: true, location: true, dateTime: true, maxPlayers: true },
          },
        },
      },
    },
  });

  if (!invite) return Response.json({ valid: false, status: "not_found" });

  await expirePendingInvites(invite.gameId);
  const fresh = await prisma.playerInvite.findUnique({ where: { token }, include: { eventPlayer: { select: { userId: true } } } });

  const session = await getSession(request);
  const isInvitee = !!session?.user && session.user.id === invite.eventPlayer.userId;
  // Guest link: anonymous shell, claimable by any logged-in user on accept.
  const claimable = !!fresh && fresh.status === "pending" && !fresh.eventPlayer.userId;

  return Response.json({
    valid: true,
    status: fresh?.status ?? invite.status,
    token,
    isInvitee,
    claimable,
    authenticated: !!session?.user,
    inviteeName: invite.eventPlayer.name,
    invitedByName: invite.invitedBy.name,
    gameId: invite.gameId,
    game: {
      id: invite.eventPlayer.event.id,
      title: invite.eventPlayer.event.title,
      location: invite.eventPlayer.event.location,
      dateTime: invite.eventPlayer.event.dateTime,
      maxPlayers: invite.eventPlayer.event.maxPlayers,
    },
  });
};

export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const token = params.token ?? "";
  const session = await getSession(request);
  if (!session?.user) return Response.json({ error: "Authentication required." }, { status: 401 });

  let body: { action?: unknown };
  try { body = await request.json(); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (body.action !== "accept" && body.action !== "decline") {
    return Response.json({ error: "action must be 'accept' or 'decline'." }, { status: 400 });
  }

  const invite = await prisma.playerInvite.findUnique({
    where: { token },
    include: { eventPlayer: { select: { userId: true, eventId: true } } },
  });
  if (!invite) return Response.json({ error: "Invite not found." }, { status: 404 });
  // Guest links (anonymous shell) are claimable by any logged-in account;
  // claimed invites stay restricted to the owning account.
  if (invite.eventPlayer.userId !== null && invite.eventPlayer.userId !== session.user.id) {
    return Response.json({ error: "This invite is not for your account." }, { status: 403 });
  }

  const game = await prisma.game.findUnique({
    where: { id: invite.gameId },
    select: { eventId: true, dateTime: true },
  });
  if (!game) return Response.json({ error: "Game not found." }, { status: 404 });
  if (game.dateTime <= new Date()) {
    // Expire + clean the pending roster ghost the invite planted (same
    // transactional shape as expirePendingInvites — see invite.server.ts).
    await prisma.$transaction([
      prisma.playerInvite.update({ where: { id: invite.id }, data: { status: "expired" } }),
      prisma.gameParticipant.deleteMany({
        where: { gameId: invite.gameId, eventPlayerId: invite.eventPlayerId, status: "pending" },
      }),
      prisma.rsvp.deleteMany({ where: { gameId: invite.gameId, eventPlayerId: invite.eventPlayerId } }),
    ]);
    return Response.json({ error: "This invite has expired." }, { status: 410 });
  }

  try {
    if (body.action === "accept") {
      const event = await prisma.event.findUnique({ where: { id: invite.eventPlayer.eventId }, select: { maxPlayers: true } });
      const result = await acceptPlayerInvite({
        token,
        userId: session.user.id,
        eventId: invite.eventPlayer.eventId,
        gameId: invite.gameId,
        maxPlayers: event?.maxPlayers ?? 0,
      });

      // Keep teams + per-game payments in sync with the new participant.
      const playerName = (await prisma.user.findUnique({ where: { id: session.user.id }, select: { name: true } }))?.name ?? "";
      await addPlayerToTeams(invite.eventPlayer.eventId, playerName, invite.gameId);
      await validateTeams(invite.eventPlayer.eventId, event?.maxPlayers ?? 0, invite.gameId);
      await syncGamePayments(invite.gameId, invite.eventPlayer.eventId);

      return Response.json({ ok: true, action: "accepted", bench: result.bench });
    }

    const result = await declinePlayerInvite({ token, userId: session.user.id, gameId: invite.gameId });
    return Response.json({ ok: true, action: "declined", status: result.status });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to process invite.";
    const status = /expired/i.test(message) ? 410 : 400;
    return Response.json({ error: message }, { status });
  }
};