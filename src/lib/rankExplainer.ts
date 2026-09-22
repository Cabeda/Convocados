/**
 * Pure helpers shared by the post-game Rank reveal and the per-event Rank
 * explainer page. No server imports — safe to use from client components and
 * to unit-test in the node project.
 */

export type RankOutcome = 1 | 0.5 | 0;

/** Win/draw/loss from the posted score, from team one's point of view. */
export function outcomeFromScore(scoreOne: number | null, scoreTwo: number | null): RankOutcome {
  if (scoreOne === null || scoreTwo === null) return 0.5;
  if (scoreOne > scoreTwo) return 1;
  if (scoreOne < scoreTwo) return 0;
  return 0.5;
}

/**
 * The viewer's Season Rank movement for one Game, as returned by
 * `postGameStatus.seasonRank`. Structurally a subset of the server's
 * `ViewerGameRank` so client components need not import a server module.
 */
export interface SeasonRankMovement {
  seasonId: string;
  seasonName: string;
  counted: boolean;
  delta: number;
  before: number;
  after: number;
  tierBefore: number;
  tierAfter: number;
  provisional: boolean;
  gamesThisSeason: number;
  edges: number[];
}

/**
 * The viewer's Crew standing inside a Season. `pointsDelta` is what the Game
 * being revealed paid the Crew; it stays null while that Game has not counted
 * yet (no score), so the UI never invents a payout. Place movement is shown by
 * `place` itself — a Crew can gain points without climbing.
 */
export interface ViewerCrewStanding {
  crewId: string;
  name: string;
  /** 1-based place among the Season's Crews. */
  place: number;
  placeCount: number;
  points: number;
  /** Points this Game paid the Crew. Null while this Game is not counted. */
  pointsDelta: number | null;
}

/**
 * The viewer's CURRENT Season Rank, as of the Games already counted —
 * independent of whether the Game being wrapped up has a score yet. Delivered
 * alongside `seasonRank` so the post-game card can show a Rank before the score
 * lands instead of an empty section.
 */
export interface SeasonRankStanding {
  seasonId: string;
  seasonName: string;
  rank: number;
  tier: number;
  provisional: boolean;
  gamesThisSeason: number;
  edges: number[];
  crew: ViewerCrewStanding | null;
}

export interface RankExplainerHrefParams {
  seasonId?: string | null;
  /** The viewer's Rank after the game. Sent as `rank`; `after` is accepted too. */
  rank?: number | null;
  delta?: number | null;
  outcome?: RankOutcome | null;
  opponentAvg?: number | null;
}

/**
 * The per-event explainer URL, pre-filled with this game's numbers so a shared
 * link reproduces the exact calculation.
 */
export function buildRankExplainerHref(eventId: string, params: RankExplainerHrefParams): string {
  const search = new URLSearchParams();
  if (params.seasonId) search.set("seasonId", params.seasonId);
  if (params.rank !== null && params.rank !== undefined) search.set("rank", String(Math.round(params.rank)));
  if (params.delta !== null && params.delta !== undefined) search.set("delta", String(params.delta));
  if (params.outcome !== null && params.outcome !== undefined) search.set("outcome", String(params.outcome));
  if (params.opponentAvg !== null && params.opponentAvg !== undefined) search.set("opponentAvg", String(params.opponentAvg));
  const query = search.toString();
  return `/events/${eventId}/rank-explainer${query ? `?${query}` : ""}`;
}
