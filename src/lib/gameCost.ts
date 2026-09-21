/**
 * Per-game cost — the fixed per-player share of a Game's total cost.
 *
 * Share = total ÷ maxPlayers (the required playing slots), NOT the current
 * roster size: the per-player price is a fixed attribute of the event and does
 * not change with how many players are on the list (ADR 0019). All callers that
 * need a share — ledger writers, balance surfaces, the cost UI — resolve it
 * here so the rounding contract lives in one place.
 */

/**
 * Per-player share in whole cents, rounded to the nearest cent.
 * Returns 0 when there are no playing slots (maxPlayers <= 0).
 */
export function perPlayerShareCents(total: number, maxPlayers: number): number {
  if (!(maxPlayers > 0)) return 0;
  return Math.round((total / maxPlayers) * 100);
}

/**
 * Per-player share in euros (2dp), rounded to the nearest cent.
 * Returns 0 when there are no playing slots (maxPlayers <= 0).
 */
export function perPlayerShare(total: number, maxPlayers: number): number {
  return perPlayerShareCents(total, maxPlayers) / 100;
}

/**
 * Per-participant share in euros (2dp), 0 when no cost or no participants.
 * The denominator is maxPlayers (the required playing slots); callers without
 * a maxPlayers value fall back to the participant count.
 */
export function shareFor(total: number, participantsCount: number, maxPlayers = participantsCount): number {
  if (participantsCount <= 0) return 0;
  return perPlayerShare(total, Math.max(1, maxPlayers));
}
