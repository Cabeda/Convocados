import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { getSession } from "../../../../lib/auth.helpers.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

/** POST — claim an anonymous player: replace it with the authenticated user's identity */
export const POST: APIRoute = async ({ params, request }) => {
  const limited = rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
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

  const target = event.players.find((p: any) => p.id === playerId);
  if (!target) return Response.json({ error: "Player not found." }, { status: 404 });

  if ((target as any).userId) {
    return Response.json({ error: "This player is already linked to an account." }, { status: 409 });
  }

  // Block claim if the user already has a linked player in this event
  const existing = event.players.find((p: any) => (p as any).userId === session.user.id);
  if (existing) {
    return Response.json({ error: "You already have a linked player in this event." }, { status: 409 });
  }

  const userName = session.user.name;
  const oldName = target.name;

  try {
    await prisma.$transaction(async (tx) => {
      // Replace the anonymous player: set name to user's name and link userId
      // Use updateMany with userId: null guard for atomicity (race protection)
      const claimed = await tx.player.updateMany({
        where: { id: playerId, eventId, userId: null } as any,
        data: { userId: session.user.id, name: userName } as any,
      });
      if (claimed.count === 0) {
        throw new Error("CLAIM_RACE");
      }

      // Update team members: rename from old anonymous name to user's name
      await tx.teamMember.updateMany({
        where: {
          name: oldName,
          team: { eventId },
        },
        data: { name: userName },
      });

      // Transfer PlayerRating: if the anonymous player had a rating, rename it
      const anonRating = await tx.playerRating.findUnique({
        where: { eventId_name: { eventId, name: oldName } },
      });
      if (anonRating) {
        await tx.playerRating.update({
          where: { id: anonRating.id },
          data: { name: userName, userId: session.user.id },
        });
      }
    });
  } catch (err: any) {
    if (err?.message === "CLAIM_RACE") {
      return Response.json({ error: "This player was already claimed by someone else." }, { status: 409 });
    }
    throw err;
  }

  return Response.json({
    ok: true,
    claimedPlayerId: playerId,
  });
};
