import { prisma } from "./db.server";
import { MVP_VOTING_WINDOW_DAYS } from "./mvp.constants";
import { findViewerName, namesFromTeamsSnapshot, normalizeName } from "./snapshotParticipants";
import { viewerRosterNames } from "./viewerIdentity.server";

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
 * The roster names (normalised) that someone can vote under: a name that is an account's name, or a
 * roster row linked to an account on this event. The second kind is what a ledger name ("Ana B") is
 * when the account is "anab99". Duplicates collapse: one roster seat is one voter.
 */
export async function eligibleVoterNames(eventId: string, rosterNames: readonly string[]): Promise<Set<string>> {
  if (rosterNames.length === 0) return new Set();
  const [users, players, eventPlayers] = await Promise.all([
    prisma.user.findMany({ where: { name: { in: [...rosterNames] } }, select: { name: true } }),
    prisma.player.findMany({ where: { eventId, userId: { not: null } }, select: { name: true } }),
    prisma.eventPlayer.findMany({ where: { eventId, userId: { not: null } }, select: { name: true } }),
  ]);
  const accounts = new Set([...users, ...players, ...eventPlayers].map((r) => normalizeName(r.name)));
  return new Set(rosterNames.map(normalizeName).filter((n) => n && accounts.has(n)));
}

export async function countEligibleVoters(eventId: string, rosterNames: readonly string[]): Promise<number> {
  return (await eligibleVoterNames(eventId, rosterNames)).size;
}

/**
 * Whether the viewer already voted for this game: a vote under one of their linked roster rows, or a
 * name-based vote under any name they are known by.
 */
export async function viewerHasVoted(
  gameHistoryId: string,
  eventId: string,
  user: { id: string },
  viewerNames: readonly string[],
): Promise<boolean> {
  const [linkedPlayers, votes] = await Promise.all([
    prisma.player.findMany({ where: { eventId, userId: user.id }, select: { id: true } }),
    prisma.mvpVote.findMany({ where: { gameHistoryId }, select: { voterPlayerId: true } }),
  ]);
  const playerIds = new Set(linkedPlayers.map((p) => p.id));
  const names = new Set(viewerNames.map(normalizeName));
  return votes.some((v) =>
    playerIds.has(v.voterPlayerId)
    || (v.voterPlayerId.startsWith("name:") && names.has(normalizeName(v.voterPlayerId.slice(5)))),
  );
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
  playerNamesByEntry?: Map<string, string[]>,
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
    // Durable Game roster when the caller resolved it (mrcokrf9), snapshot residue otherwise.
    const names = playerNamesByEntry?.get(e.id) ?? namesFromTeamsSnapshot(e.teamsSnapshot);
    namesByEntry.set(e.id, names);
    for (const n of names) allNames.add(n);
  }
  const nameList = [...allNames];

  const [players, eligible] = await Promise.all([
    nameList.length
      ? prisma.player.findMany({
          where: { eventId: event.id, name: { in: nameList } },
          select: { id: true, name: true },
        })
      : Promise.resolve([] as { id: string; name: string }[]),
    eligibleVoterNames(event.id, nameList),
  ]);
  const playerByName = new Map(players.map((p) => [p.name.toLowerCase(), p]));

  // Every name the viewer is known by on this event (account name + linked roster rows), the same
  // identity the vote endpoint and the post-game status read.
  let sessionPlayerIds: string[] = [];
  let viewerNames: string[] = [];
  if (session?.user?.id) {
    viewerNames = await viewerRosterNames(event.id, session.user);
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
    const eligibleVoters = new Set(names.map(normalizeName).filter((n) => eligible.has(n))).size;

    let hasVoted: boolean | null = null;
    const playedAs = session?.user?.id ? findViewerName(viewerNames, names) : null;
    if (playedAs) {
      const voterIds = new Set(sessionPlayerIds);
      const byNameId = playerByName.get(playedAs.toLowerCase())?.id;
      if (voterIds.size === 0 && byNameId) voterIds.add(byNameId);
      const known = new Set(viewerNames.map(normalizeName));
      hasVoted = votes.some((v) =>
        voterIds.has(v.voterPlayerId)
        || (v.voterPlayerId.startsWith("name:") && known.has(normalizeName(v.voterPlayerId.slice(5)))),
      );
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
