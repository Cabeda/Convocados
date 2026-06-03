import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";
import { normalizeForMatch } from "../../../../lib/stringMatch";

export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id ?? "";

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { players: true },
  });

  if (!event) {
    return Response.json({ error: "Not found." }, { status: 404 });
  }

  const currentPlayerNames = new Set(
    event.players.map((p) => p.name.toLowerCase())
  );

  const history = await prisma.gameHistory.findMany({
    where: { eventId, status: "played" },
    select: { teamsSnapshot: true },
  });

  const nameCounts: Map<string, number> = new Map();

  for (const entry of history) {
    if (!entry.teamsSnapshot) continue;

    try {
      const teams = JSON.parse(entry.teamsSnapshot) as Array<{
        team: string;
        players: Array<{ name: string; order: number }>;
      }>;

      for (const team of teams) {
        for (const player of team.players) {
          const name = player.name.trim();
          if (name) {
            nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
          }
        }
      }
    } catch {
      continue;
    }
  }

  // Annotate each suggestion with the userId of the matching registered user
  // (if any). Ambiguous matches (multiple users sharing the name) stay null.
  const allUsers = await prisma.user.findMany({
    select: { id: true, name: true },
  });
  const userByNormalized = new Map<string, string[]>();
  for (const u of allUsers) {
    const key = normalizeForMatch(u.name);
    if (!key) continue;
    const list = userByNormalized.get(key) ?? [];
    list.push(u.id);
    userByNormalized.set(key, list);
  }

  const players = Array.from(nameCounts.entries())
    .filter(([name]) => !currentPlayerNames.has(name.toLowerCase()))
    .map(([name, gamesPlayed]) => {
      const matches = userByNormalized.get(normalizeForMatch(name)) ?? [];
      return {
        name,
        gamesPlayed,
        userId: matches.length === 1 ? matches[0] : null,
      };
    })
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    .slice(0, 30);

  return Response.json({ players });
};