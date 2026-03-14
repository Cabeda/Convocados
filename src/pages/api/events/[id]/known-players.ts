import type { APIRoute } from "astro";
import { prisma } from "../../../../lib/db.server";

export const GET: APIRoute = async ({ params }) => {
  const eventId = params.id!;
  
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
  
  const players = Array.from(nameCounts.entries())
    .filter(([name]) => !currentPlayerNames.has(name.toLowerCase()))
    .map(([name, gamesPlayed]) => ({ name, gamesPlayed }))
    .sort((a, b) => b.gamesPlayed - a.gamesPlayed)
    .slice(0, 30);
  
  return Response.json({ players });
};