import { prisma } from "./db.server";
import { MVP_VOTING_WINDOW_DAYS } from "./mvp.constants";
import { namesFromTeamsSnapshot } from "./snapshotParticipants";

export interface MvpSummary {
  mvp: { playerId: string; playerName: string; voteCount: number }[] | null;
  isVotingOpen: boolean;
  hasVoted: boolean | null;
  totalVotes: number;
  eligibleVoters: number;
  participants: { id: string; name: string; voteCount: number }[];
}

export interface MvpSummaryEntry {
  id: string;
  dateTime: Date | string;
  createdAt: Date | string;
  status: string;
  teamsSnapshot: string | null;
}

interface MvpSummaryEvent {
  id: string;
  durationMinutes: number | null;
  mvpEnabled: boolean | null;
}

/**
 * Batch version of GET /api/events/[id]/history/[historyId]/mvp.
 *
 * The history page renders up to `DEFAULT_PAGE_SIZE` cards, and each card used
 * to fetch its own MVP summary — an N+1 that got worse the more games an event
 * had. This computes every summary for a page in a fixed number of queries so
 * the page can ship the data with the list response instead.
 */
export async function buildMvpSummaries(
  event: MvpSummaryEvent,
  entries: MvpSummaryEntry[],
  session: { user?: { id: string; name?: string | null } } | null,
): Promise<Map<string, MvpSummary>> {
  const result = new Map<string, MvpSummary>();
  if (entries.length === 0) return result;

  const ids = entries.map((e) => e.id);

  const [allVotes, latestPlayed] = await Promise.all([
    prisma.mvpVote.findMany({ where: { gameHistoryId: { in: ids } } }),
    prisma.gameHistory.findFirst({
      where: { eventId: event.id, status: "played" },
      orderBy: { dateTime: "desc" },
      select: { id: true },
    }),
  ]);
  const latestId = latestPlayed?.id ?? null;

  const votesByGame = new Map<string, typeof allVotes>();
  for (const v of allVotes) {
    const bucket = votesByGame.get(v.gameHistoryId);
    if (bucket) bucket.push(v);
    else votesByGame.set(v.gameHistoryId, [v]);
  }

  const namesByEntry = new Map<string, string[]>();
  const allNames = new Set<string>();
  for (const e of entries) {
    const names = namesFromTeamsSnapshot(e.teamsSnapshot);
    namesByEntry.set(e.id, names);
    for (const n of names) allNames.add(n);
  }
  const nameList = [...allNames];

  const [players, users] = await Promise.all([
    nameList.length
      ? prisma.player.findMany({
          where: { eventId: event.id, name: { in: nameList } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    nameList.length
      ? prisma.user.findMany({ where: { name: { in: nameList } }, select: { name: true } })
      : Promise.resolve([] as { name: string | null }[]),
  ]);
  const playerByName = new Map(players.map((p) => [p.name.toLowerCase(), p]));
  const userNames = new Set(users.map((u) => u.name ?? "").filter(Boolean));

  let sessionPlayerIds: string[] = [];
  const sessionName = session?.user?.name ?? null;
  if (session?.user?.id) {
    const userPlayers = await prisma.player.findMany({
      where: { eventId: event.id, userId: session.user.id },
      select: { id: true },
    });
    sessionPlayerIds = userPlayers.map((p) => p.id);
  }

  const now = Date.now();
  for (const e of entries) {
    const votes = votesByGame.get(e.id) ?? [];
    const dateTime = e.dateTime instanceof Date ? e.dateTime : new Date(e.dateTime);
    const createdAt = e.createdAt instanceof Date ? e.createdAt : new Date(e.createdAt);
    const gameEndTime = dateTime.getTime() + (event.durationMinutes ?? 60) * 60_000;
    const gameEnded = gameEndTime <= now;
    const withinWindow = (now - createdAt.getTime()) / 86_400_000 <= MVP_VOTING_WINDOW_DAYS;
    const isLatestGame = latestId === e.id;
    const isVotingOpen =
      gameEnded && isLatestGame && withinWindow && e.status === "played" && (event.mvpEnabled ?? true);

    let mvp: MvpSummary["mvp"] = null;
    if (votes.length > 0) {
      const tally = new Map<string, { playerId: string; playerName: string; count: number }>();
      for (const v of votes) {
        const existing = tally.get(v.votedForPlayerId);
        if (existing) existing.count++;
        else tally.set(v.votedForPlayerId, { playerId: v.votedForPlayerId, playerName: v.votedForName, count: 1 });
      }
      const maxVotes = Math.max(...[...tally.values()].map((t) => t.count));
      mvp = [...tally.values()]
        .filter((t) => t.count === maxVotes)
        .map((t) => ({ playerId: t.playerId, playerName: t.playerName, voteCount: t.count }));
    }

    const names = namesByEntry.get(e.id) ?? [];
    const tallyByName = new Map<string, number>();
    for (const v of votes) {
      tallyByName.set(v.votedForPlayerId, (tallyByName.get(v.votedForPlayerId) ?? 0) + 1);
    }
    const seen = new Set<string>();
    const participants: MvpSummary["participants"] = [];
    for (const n of names) {
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const match = playerByName.get(key);
      const id = match ? match.id : `name:${n}`;
      participants.push({ id, name: match?.name ?? n, voteCount: tallyByName.get(id) ?? 0 });
    }
    const eligibleVoters = names.filter((n) => userNames.has(n)).length;

    let hasVoted: boolean | null = null;
    if (session?.user?.id && sessionName && names.some((n) => n.toLowerCase() === sessionName.toLowerCase())) {
      let voterIds = sessionPlayerIds;
      if (voterIds.length === 0) {
        const matchName = names.find((n) => n.toLowerCase() === sessionName.toLowerCase());
        const player = matchName ? playerByName.get(matchName.toLowerCase()) : undefined;
        if (player) voterIds = [player.id];
      }
      if (voterIds.length > 0) {
        hasVoted = votes.some((v) => voterIds.includes(v.voterPlayerId));
      } else {
        hasVoted = votes.some((v) => v.voterPlayerId === `name:${sessionName}`);
      }
    }

    result.set(e.id, {
      mvp,
      isVotingOpen,
      hasVoted,
      totalVotes: votes.length,
      eligibleVoters,
      participants,
    });
  }

  return result;
}
