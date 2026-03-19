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

  // Get ALL players first to validate team membership
  const allPlayers = await prisma.player.findMany({
    where: { eventId },
    orderBy: { order: "asc" },
  });

  // Take only active players for team generation
  const players = allPlayers.slice(0, event.maxPlayers);

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

  // Validate: ensure only active players are in teams
  const activePlayerNames = new Set(players.map(p => p.name));
  for (const match of matches) {
    for (const player of match.players) {
      if (!activePlayerNames.has(player.name)) {
        console.error(`Invalid player "${player.name}" in teams (not in active players list)`);
        return Response.json(
          { error: `Player "${player.name}" cannot be in teams. Only active players (order < ${event.maxPlayers}) can participate.` },
          { status: 400 }
        );
      }
    }
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
