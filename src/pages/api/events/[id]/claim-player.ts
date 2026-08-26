import type { APIRoute } from "astro";
import type { Player } from "@prisma/client";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";
import { enqueuePushSetupHintSafe } from "../../../../lib/pushSetupHint";

/** POST — claim an anonymous player: replace it with the authenticated user's identity */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = await rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id ?? "";
  const session = await getSession(request);
  if (!session?.user) {
    return Response.json({ error: "Authentication required." }, { status: 401 });
  }

  const { playerId } = await request.json();
  if (!playerId) {
    return Response.json({ error: "playerId is required." }, { status: 400 });
  }

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: { orderBy: { order: "asc" } } },
  });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  // ADR 0016: the event GET returns EventPlayer ids. Fall back to a name-based
  // lookup (active Player row) when playerId is an EventPlayer id.
  let target = event.players.find((p: Player) => p.id === playerId);
  if (!target) {
    const ep = await prisma.eventPlayer.findFirst({ where: { id: playerId, eventId } });
    if (ep) {
      target = event.players.find((p: Player) => p.name === ep.name && !p.archivedAt)
        ?? event.players.find((p: Player) => p.name === ep.name);
    }
  }
  // ADR 0026: guest invite rows have no legacy Player at all. The EventPlayer
  // itself is a valid claim target while it is still anonymous.
  let guestEp: { id: string; userId: string | null; name: string } | null = null;
  if (!target) {
    const ep = await prisma.eventPlayer.findFirst({ where: { id: playerId, eventId } });
    if (ep && !ep.userId) {
      guestEp = { id: ep.id, userId: ep.userId, name: ep.name };
    }
  }
  if (!target && !guestEp) return Response.json({ error: "Player not found." }, { status: 404 });

  if (target?.userId) {
    return Response.json({ error: "This player is already linked to an account." }, { status: 409 });
  }

  // Block claim if the user already has a linked player in this event
  const existing = event.players.find((p: Player) => p.userId === session.user.id);
  if (existing) {
    return Response.json({ error: "You already have a linked player in this event." }, { status: 409 });
  }
  // ADR 0026: also consider EventPlayer-native rows (guest invite links leave
  // only an EventPlayer, no legacy Player row).
  const existingEp = await prisma.eventPlayer.findFirst({
    where: { eventId, userId: session.user.id },
    select: { id: true },
  });
  if (existingEp) {
    return Response.json({ error: "You already have a linked player in this event." }, { status: 409 });
  }

  const userName = session.user.name;
  const oldName: string = target?.name ?? guestEp?.name ?? "";

  try {
    await prisma.$transaction(async (tx) => {
      if (target) {
        // Legacy path: replace the anonymous Player row.
        const claimed = await tx.player.updateMany({
          where: { id: target.id, eventId, userId: null },
          data: { userId: session.user.id, name: userName },
        });
        if (claimed.count === 0) throw new Error("CLAIM_RACE");
      } else {
        // ADR 0026 guest-row path: the claim target is an anonymous
        // EventPlayer with no legacy Player. Bind it atomically.
        const claimed = await tx.eventPlayer.updateMany({
          where: { id: playerId, eventId, userId: null },
          data: { userId: session.user.id, name: userName },
        });
        if (claimed.count === 0) throw new Error("CLAIM_RACE");
      }

      // Shared rename fan-out (both paths)
      await tx.teamMember.updateMany({
        where: { name: oldName, team: { eventId } },
        data: { name: userName },
      });

      const anonRating = await tx.playerRating.findUnique({
        where: { eventId_name: { eventId, name: oldName } },
      });
      if (anonRating) {
        await tx.playerRating.update({
          where: { id: anonRating.id },
          data: { name: userName, userId: session.user.id },
        });
      }

      const histories = await tx.gameHistory.findMany({
        where: { eventId },
        select: { id: true, teamsSnapshot: true },
      });
      for (const h of histories) {
        if (!h.teamsSnapshot || !h.teamsSnapshot.includes(oldName)) continue;
        try {
          const teams: { team: string; players: { name: string; order: number }[] }[] = JSON.parse(h.teamsSnapshot);
          let changed = false;
          for (const team of teams) {
            for (const p of team.players) {
              if (p.name === oldName) {
                p.name = userName;
                changed = true;
              }
            }
          }
          if (changed) {
            await tx.gameHistory.update({
              where: { id: h.id },
              data: { teamsSnapshot: JSON.stringify(teams) },
            });
          }
        } catch { /* malformed JSON — skip */ }
      }
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.message === "CLAIM_RACE") {
      return Response.json({ error: "This player was already claimed by someone else." }, { status: 409 });
    }
    throw err;
  }


  // Auto-follow on claim
  await prisma.eventFollow.upsert({
    where: { eventId_userId: { eventId, userId: session.user.id } },
    create: { eventId, userId: session.user.id },
    update: {},
  });
  enqueuePushSetupHintSafe(session.user.id, eventId);

  return Response.json({
    ok: true,
    claimedPlayerId: target?.id ?? playerId,
  });
};
