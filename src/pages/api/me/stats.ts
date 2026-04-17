import type { APIRoute } from "astro";
import { prisma } from "../../../lib/db.server";
import { getSession } from "../../../lib/auth.helpers.server";
import { authenticateRequest } from "../../../lib/authenticate.server";
import { calculateAttendance } from "../../../lib/attendance";

export const GET: APIRoute = async ({ request }) => {
  // Support both OAuth bearer tokens and session cookies
  const authCtx = await authenticateRequest(request);
  const session = authCtx ? null : await getSession(request);
  const userId = authCtx?.userId ?? session?.user?.id;
  if (!userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userName = session?.user?.name
    ?? (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name
    ?? "";

  // Get all PlayerRating entries for this user across all events
  const ratings = await prisma.playerRating.findMany({
    where: { userId },
    include: {
      event: {
        select: { id: true, title: true, sport: true },
      },
    },
    orderBy: { rating: "desc" },
  });

  // Also find ratings by name match for events where user is a player but userId wasn't set on rating
  const playerEvents = await prisma.player.findMany({
    where: { userId },
    select: { eventId: true, name: true },
  });

  const ratingEventIds = new Set(ratings.map((r) => r.eventId));
  const missingEvents = playerEvents.filter((p) => !ratingEventIds.has(p.eventId));

  const extraRatings = missingEvents.length > 0
    ? await prisma.playerRating.findMany({
        where: {
          OR: missingEvents.map((p) => ({
            eventId: p.eventId,
            name: p.name,
          })),
        },
        include: {
          event: {
            select: { id: true, title: true, sport: true },
          },
        },
      })
    : [];

  const allRatings = [...ratings, ...extraRatings];

  // Deduplicate by eventId (prefer the one with userId set)
  const byEvent = new Map<string, typeof allRatings[number]>();
  for (const r of allRatings) {
    const existing = byEvent.get(r.eventId);
    if (!existing || (r.userId && !existing.userId)) {
      byEvent.set(r.eventId, r);
    }
  }

  const uniqueRatings = Array.from(byEvent.values());

  // Count MVP awards per event and total — computed after playerNameByEvent is built (below)
  // TODO: optimize — currently fetches ALL votes for all events; consider a DB-level aggregation
  const allEventIds = uniqueRatings.map((r) => r.eventId);
  const mvpVotes = allEventIds.length > 0
    ? await prisma.mvpVote.findMany({
        where: {
          gameHistory: { eventId: { in: allEventIds } },
        },
        select: {
          votedForPlayerId: true,
          votedForName: true,
          gameHistoryId: true,
          gameHistory: { select: { eventId: true } },
        },
      })
    : [];

  // Tally votes per game
  const votesByGame = new Map<string, Map<string, { name: string; count: number; eventId: string }>>();
  for (const v of mvpVotes) {
    const gameId = v.gameHistoryId;
    if (!votesByGame.has(gameId)) votesByGame.set(gameId, new Map());
    const gameTally = votesByGame.get(gameId)!;
    const existing = gameTally.get(v.votedForPlayerId);
    if (existing) {
      existing.count++;
    } else {
      gameTally.set(v.votedForPlayerId, { name: v.votedForName, count: 1, eventId: v.gameHistory.eventId });
    }
  }

  // Aggregate summary
  const totalGames = uniqueRatings.reduce((sum, r) => sum + r.gamesPlayed, 0);
  const totalWins = uniqueRatings.reduce((sum, r) => sum + r.wins, 0);
  const totalDraws = uniqueRatings.reduce((sum, r) => sum + r.draws, 0);
  const totalLosses = uniqueRatings.reduce((sum, r) => sum + r.losses, 0);
  const avgRating = uniqueRatings.length > 0
    ? uniqueRatings.reduce((sum, r) => sum + r.rating, 0) / uniqueRatings.length
    : 0;
  const winRate = totalGames > 0 ? totalWins / totalGames : 0;
  const bestRating = uniqueRatings.length > 0
    ? Math.max(...uniqueRatings.map((r) => r.rating))
    : 0;

  // Per-event breakdown with attendance
  const eventIds = uniqueRatings.map((r) => r.eventId);
  const histories = eventIds.length > 0
    ? await prisma.gameHistory.findMany({
        where: { eventId: { in: eventIds } },
        select: { eventId: true, status: true, dateTime: true, teamsSnapshot: true },
        orderBy: { dateTime: "asc" },
      })
    : [];

  const historyByEvent = new Map<string, typeof histories>();
  for (const h of histories) {
    const arr = historyByEvent.get(h.eventId) ?? [];
    arr.push(h);
    historyByEvent.set(h.eventId, arr);
  }

  // Get the player name used in each event
  const playerNameByEvent = new Map<string, string>();
  for (const r of uniqueRatings) {
    playerNameByEvent.set(r.eventId, r.name);
  }

  // Compute MVP awards now that playerNameByEvent is available
  const mvpAwardsByEvent = new Map<string, number>();
  let totalMvpAwards = 0;
  for (const [, gameTally] of votesByGame) {
    const maxVotes = Math.max(...Array.from(gameTally.values()).map((t) => t.count));
    if (maxVotes < 1) continue;
    const mvps = Array.from(gameTally.values()).filter((t) => t.count === maxVotes);
    for (const mvp of mvps) {
      const playerName = playerNameByEvent.get(mvp.eventId);
      if (playerName && mvp.name.toLowerCase() === playerName.toLowerCase()) {
        totalMvpAwards++;
        mvpAwardsByEvent.set(mvp.eventId, (mvpAwardsByEvent.get(mvp.eventId) ?? 0) + 1);
      }
    }
  }

  const events = uniqueRatings
    .sort((a, b) => b.rating - a.rating)
    .map((r) => {
      const eventHistory = historyByEvent.get(r.eventId) ?? [];
      const attendanceResult = calculateAttendance(eventHistory);
      const playerName = playerNameByEvent.get(r.eventId) ?? userName;
      const playerAttendance = attendanceResult.players.find((p) => p.name === playerName);

      return {
        eventId: r.eventId,
        eventTitle: r.event.title,
        sport: r.event.sport,
        rating: Math.round(r.rating),
        gamesPlayed: r.gamesPlayed,
        wins: r.wins,
        draws: r.draws,
        losses: r.losses,
        winRate: r.gamesPlayed > 0 ? Math.round((r.wins / r.gamesPlayed) * 100) / 100 : 0,
        attendance: playerAttendance
          ? {
              gamesPlayed: playerAttendance.gamesPlayed,
              totalGames: playerAttendance.totalGames,
              attendanceRate: playerAttendance.attendanceRate,
              currentStreak: playerAttendance.currentStreak,
            }
          : null,
        mvpAwards: mvpAwardsByEvent.get(r.eventId) ?? 0,
      };
    });

  return Response.json({
    summary: {
      totalGames,
      totalWins,
      totalDraws,
      totalLosses,
      winRate: Math.round(winRate * 100) / 100,
      avgRating: Math.round(avgRating),
      bestRating: Math.round(bestRating),
      eventsPlayed: uniqueRatings.length,
      totalMvpAwards,
    },
    events,
  });
};
