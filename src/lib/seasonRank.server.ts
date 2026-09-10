/**
 * Season Rank server logic (ADR 0031).
 *
 * The ACTIVE Season's Rank is derived on read (pure replay via computeSeasonRank)
 * from the Season's qualifying games + the canonical Skill Rating. Only the
 * completion snapshot persists. This keeps the Elo recompute paths Rank-agnostic.
 */
import { prisma } from "./db.server";
import { getLifetimeSkill } from "./skill.server";
import {
  calculateLeaderboard,
  filterLeaderboardGames,
  type LeaderboardGame,
  type SeasonMember,
} from "./leaderboard";
import {
  computeSeasonRank,
  provisionalGames,
  seedRank,
  softReset,
  tierEdges,
  TIER_NAMES,
  type PlayerRank,
  type RankGame,
} from "./seasonRank";

/** Minimum season games before a Tier is shown. */
export const PROVISIONAL_MIN = 3;

export interface SeasonRankPlayer {
  name: string;
  hidden: number;
  display: number;
  tier: number;
  tierName: string | null;
  games: number;
  provisional: boolean;
}

export interface SeasonRankPayload {
  seasonId: string;
  players: SeasonRankPlayer[];
  edges: number[];
  anchor: number;
  gamesCount: number;
  enabled: boolean;
}

interface SnapshotPlayer {
  name: string;
  hidden: number;
  display: number;
  tier: number;
  games: number;
}

interface SnapshotPayload {
  players: SnapshotPlayer[];
  crews: unknown[];
  winner: string | null;
}

interface SnapshotTeam {
  team: string;
  players: Array<{ name: string }>;
}

function parseTeamsSnapshot(value: string | null): [LeaderboardGame["teams"][0], LeaderboardGame["teams"][1]] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as SnapshotTeam[];
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const teams = parsed.map((t) => ({
      name: t.team,
      players: (t.players ?? []).map((p) => p.name),
    }));
    if (teams.some((t) => !t.name || t.players.length === 0)) return null;
    return teams as [LeaderboardGame["teams"][0], LeaderboardGame["teams"][1]];
  } catch {
    return null;
  }
}

function toGame(row: {
  id: string;
  dateTime: Date;
  status: string;
  isFriendly: boolean;
  scoreOne: number | null;
  scoreTwo: number | null;
  teamsSnapshot: string | null;
}): LeaderboardGame | null {
  const teams = parseTeamsSnapshot(row.teamsSnapshot);
  return teams ? { id: row.id, dateTime: row.dateTime, status: row.status, isFriendly: row.isFriendly, scoreOne: row.scoreOne, scoreTwo: row.scoreTwo, teams } : null;
}

/** Season window: registration window, capped by completion/cancellation. */
function seasonWindow(season: { registrationOpensAt: Date; registrationClosesAt: Date; completedAt: Date | null; cancelledAt: Date | null }) {
  const startsAt = season.registrationOpensAt;
  const completedEndsAt = season.completedAt ?? season.cancelledAt;
  const closesAt = season.registrationClosesAt;
  const endsAt = completedEndsAt && completedEndsAt < closesAt ? completedEndsAt : closesAt;
  return { startsAt, endsAt };
}

/**
 * Derive (once) and persist the Event's frozen Rank calibration: anchor = min
 * established Skill Rating, edges = percentile tiers. Re-derived only by an
 * audited admin action.
 */
export async function ensureRankCalibration(eventId: string): Promise<{ anchor: number; edges: number[] }> {
  const event = await prisma.event.findUnique({
    where: { id: eventId },
    select: { rankAnchor: true, rankTierEdges: true },
  });
  if (event?.rankAnchor != null && event.rankTierEdges) {
    try {
      return { anchor: event.rankAnchor, edges: JSON.parse(event.rankTierEdges) as number[] };
    } catch {
      /* fall through and re-derive */
    }
  }

  const established = await prisma.playerRating.findMany({
    where: { eventId, gamesPlayed: { gte: PROVISIONAL_MIN } },
    select: { rating: true },
  });
  const anchor = established.length ? Math.min(...established.map((r) => r.rating)) : 1000;
  const edges = tierEdges(established.map((r) => seedRank(r.rating, anchor)), TIER_NAMES.length);

  await prisma.event.update({ where: { id: eventId }, data: { rankAnchor: anchor, rankTierEdges: JSON.stringify(edges) } });
  return { anchor, edges };
}

/** Latest prior completion snapshot before `season`, keyed by player name. */
async function loadPriorRank(eventId: string, beforeOpensAt: Date): Promise<Map<string, SnapshotPlayer>> {
  const prior = await prisma.seasonRankSnapshot.findFirst({
    where: { eventId, season: { registrationOpensAt: { lt: beforeOpensAt } } },
    orderBy: { season: { registrationOpensAt: "desc" } },
    select: { payload: true },
  });
  if (!prior) return new Map();
  try {
    const parsed = JSON.parse(prior.payload) as SnapshotPayload;
    return new Map(parsed.players.map((p) => [p.name, p]));
  } catch {
    return new Map();
  }
}

/** Replay one Season's Rank. Pure given the DB inputs. */
export async function deriveSeasonRank(eventId: string, seasonId: string): Promise<SeasonRankPayload | null> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { memberships: { include: { eventPlayer: true } } },
  });
  if (!season || season.eventId !== eventId) return null;

  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { rankEnabled: true } });
  const { anchor, edges } = await ensureRankCalibration(eventId);

  const { startsAt, endsAt } = seasonWindow(season);
  const history = await prisma.gameHistory.findMany({ where: { eventId }, orderBy: { dateTime: "asc" } });
  const allGames = history.map(toGame).filter((g): g is LeaderboardGame => g !== null);
  const qualifying = filterLeaderboardGames(allGames, { startsAt, endsAt });

  const memberNames = season.memberships.map((m) => m.eventPlayer.name);
  const participantNames = new Set<string>();
  for (const g of qualifying) for (const t of g.teams) for (const p of t.players) participantNames.add(p);
  const names = [...new Set([...memberNames, ...participantNames])];

  const skill = await getLifetimeSkill(eventId, names);
  const prior = await loadPriorRank(eventId, season.registrationOpensAt);

  const seeds: Record<string, number> = {};
  const seeded: Record<string, boolean> = {};
  const skillRecord: Record<string, number> = {};
  for (const n of names) {
    const s = skill.get(n) ?? { rating: 1000, gamesPlayed: 0 };
    skillRecord[n] = s.rating;
    const p = prior.get(n);
    if (p) {
      seeds[n] = softReset(p.hidden, seedRank(s.rating, anchor));
      seeded[n] = true;
    } else {
      seeds[n] = seedRank(s.rating, anchor);
      seeded[n] = s.gamesPlayed > 0;
    }
  }

  const games: RankGame[] = qualifying.map((g) => ({
    teamOne: g.teams[0].players,
    teamTwo: g.teams[1].players,
    scoreOne: g.scoreOne ?? 0,
    scoreTwo: g.scoreTwo ?? 0,
  }));

  const result = computeSeasonRank({
    games,
    skill: skillRecord,
    seeds,
    seeded,
    provisionalWindow: provisionalGames(Math.max(qualifying.length, 1)),
    edges,
  });

  const players: SeasonRankPlayer[] = season.memberships.map((m) => {
    const r = result.get(m.eventPlayer.name);
    return toPlayer(m.eventPlayer.name, r);
  });

  return {
    seasonId,
    players,
    edges,
    anchor,
    gamesCount: qualifying.length,
    enabled: event?.rankEnabled ?? true,
  };
}

function toPlayer(name: string, r: PlayerRank | undefined): SeasonRankPlayer {
  const games = r?.gamesThisSeason ?? 0;
  const provisional = games < PROVISIONAL_MIN;
  const tier = r?.tier ?? 0;
  return {
    name,
    hidden: r?.hidden ?? 0,
    display: r?.display ?? 0,
    tier,
    tierName: provisional ? null : (TIER_NAMES[tier] ?? null),
    games,
    provisional,
  };
}

/** Snapshot if frozen, otherwise derive live. */
export async function getSeasonRankPayload(eventId: string, seasonId: string): Promise<SeasonRankPayload | null> {
  const snapshot = await prisma.seasonRankSnapshot.findUnique({ where: { seasonId }, select: { payload: true } });
  if (snapshot) {
    try {
      const parsed = JSON.parse(snapshot.payload) as SnapshotPayload;
      const event = await prisma.event.findUnique({ where: { id: eventId }, select: { rankAnchor: true, rankTierEdges: true } });
      return {
        seasonId,
        players: parsed.players.map((p) => ({
          name: p.name,
          hidden: p.hidden,
          display: p.display,
          tier: p.tier,
          tierName: TIER_NAMES[p.tier] ?? null,
          games: p.games,
          provisional: p.games < PROVISIONAL_MIN,
        })),
        edges: event?.rankTierEdges ? (JSON.parse(event.rankTierEdges) as number[]) : [],
        anchor: event?.rankAnchor ?? 0,
        gamesCount: parsed.players.reduce((max, p) => Math.max(max, p.games), 0),
        enabled: true,
      };
    } catch {
      /* fall through to live derive */
    }
  }
  return deriveSeasonRank(eventId, seasonId);
}

/**
 * Freeze a completion snapshot (Season Rank + Crew standings + winner).
 * Idempotent: replaces any existing snapshot (reopen/re-finalise).
 */
export async function snapshotSeasonRank(eventId: string, seasonId: string): Promise<void> {
  const season = await prisma.season.findUnique({
    where: { id: seasonId },
    include: { memberships: { include: { eventPlayer: true, crew: true } } },
  });
  if (!season || season.eventId !== eventId) return;

  const rank = await deriveSeasonRank(eventId, seasonId);
  const { startsAt, endsAt } = seasonWindow(season);
  const history = await prisma.gameHistory.findMany({ where: { eventId }, orderBy: { dateTime: "asc" } });
  const allGames = history.map(toGame).filter((g): g is LeaderboardGame => g !== null);

  const seasonMembers: SeasonMember[] = season.memberships.map((m) => ({
    membershipId: m.id,
    name: m.eventPlayer.name,
    crewId: m.crewId,
    crewName: m.crew?.name ?? null,
    joinedAt: m.joinedAt,
    withdrawnAt: m.withdrawnAt,
  }));
  const standings = calculateLeaderboard(allGames, seasonMembers, {
    startsAt,
    endsAt,
    seasonEndsAt: season.registrationClosesAt,
  });

  const payload: SnapshotPayload = {
    players: (rank?.players ?? []).map((p) => ({ name: p.name, hidden: p.hidden, display: p.display, tier: p.tier, games: p.games })),
    crews: standings.crews,
    winner: standings.crews[0]?.name ?? null,
  };

  await prisma.seasonRankSnapshot.upsert({
    where: { seasonId },
    create: { seasonId, eventId, payload: JSON.stringify(payload) },
    update: { payload: JSON.stringify(payload) },
  });
}

/** Remove a snapshot (cancellation). */
export async function clearSeasonRankSnapshot(seasonId: string): Promise<void> {
  await prisma.seasonRankSnapshot.deleteMany({ where: { seasonId } });
}
