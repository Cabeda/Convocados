/**
 * Co-play suggestion ranking (ADR 0025 / Phase 4a).
 *
 * Pure functions — no DB access — so the scoring logic is unit-testable.
 *
 * Ranking formula: score = Σ over co-play games of recencyWeight(gameDateTime)
 *   where recencyWeight = exp(-daysAgo / 90). Recent games count ~1, games
 *   decay exponentially with a 90-day half-life-ish timescale. More frequent
 *   co-players score higher; recent co-play outweighs old co-play.
 *
 * Penalty: a candidate with >= 3 declined PlayerInvites on the event gets
 *   score × 0.1 (sinks to the bottom but is not dropped entirely).
 */

export const RECENCY_HALF_LIFE_DAYS = 90;
export const DECLINE_PENALTY_THRESHOLD = 3;
export const DECLINE_PENALTY_FACTOR = 0.1;
export const SUGGESTIONS_CAP = 20;

/**
 * Co-play history window (days). Games older than this are excluded from the
 * ranking query. A game CO_PLAY_WINDOW_DAYS ago contributes exp(-window/90)
 * to the score (~2% at 365d), so older co-plays are noise — bounding the
 * window keeps the endpoint query cheap for accounts with long histories.
 */
export const CO_PLAY_WINDOW_DAYS = 365;

export interface CoPlayRecord {
  userId: string;
  name: string;
  gamesPlayed: number;
  gameDateTime: Date;
}

/**
 * Exponential recency decay for a single co-play game.
 * Games in the future clamp to weight 1.
 */
export function recencyWeight(gameDateTime: Date, now: Date): number {
  const msAgo = now.getTime() - gameDateTime.getTime();
  const daysAgo = Math.max(0, msAgo / 86_400_000);
  return Math.exp(-daysAgo / RECENCY_HALF_LIFE_DAYS);
}

/** Sum of recency weights across all co-play games with one candidate. */
export function computeCoPlayScore(records: CoPlayRecord[], now: Date): number {
  return records.reduce((total, record) => total + recencyWeight(record.gameDateTime, now), 0);
}

/** Soft penalty: repeated declines sink, but do not remove, a candidate. */
export function applyDeclinePenalty(score: number, declinedCount: number): number {
  if (declinedCount >= DECLINE_PENALTY_THRESHOLD) {
    return score * DECLINE_PENALTY_FACTOR;
  }
  return score;
}