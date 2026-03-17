import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { Randomize } from "../../../../lib/random";
import { balanceTeams } from "../../../../lib/elo.server";
import { rateLimitResponse } from "../../../../lib/apiRateLimit.server";

export const POST: APIRoute = async ({ params, url, request }) => {
  const limited = rateLimitResponse(request, "write");
  if (limited) return limited;

  const eventId = params.id!;
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) return Response.json({ error: "Not found." }, { status: 404 });

  const players = await prisma.player.findMany({
    where: { eventId },
    orderBy: { createdAt: "asc" },
    take: event.maxPlayers,
  });
  if (players.length < 2) return Response.json({ error: "Need at least 2 players." }, { status: 400 });

  const balanced = url.searchParams.get("balanced") === "true";
  let matches;

  if (balanced) {
    const ratings = await prisma.playerRating.findMany({ where: { eventId } });
    const ratingMap = new Map(ratings.map((r) => [r.name, r.rating]));
    const playersWithRatings = players.map((p) => ({
      name: p.name,
      rating: ratingMap.get(p.name) ?? 1000,
    }));
    matches = balanceTeams(playersWithRatings, [event.teamOneName, event.teamTwoName]);
  } else {
    matches = Randomize(players.map((p) => p.name), [event.teamOneName, event.teamTwoName]);
  }

  await prisma.$transaction([
    prisma.teamResult.deleteMany({ where: { eventId } }),
    ...matches.map((match) =>
      prisma.teamResult.create({
        data: {
          name: match.team,
          eventId,
          members: { create: match.players.map((p) => ({ name: p.name, order: p.order })) },
        },
      })
    ),
  ]);

  return Response.json({ ok: true, balanced });
};
