/**
 * Feature flag for the WalletTransaction read path (ADR 0019).
 *
 * After the migration, balance functions read from `WalletTransaction` (the
 * ledger) instead of `PlayerPayment` + `GameHistory.paymentsSnapshot` (the
 * legacy read path). The legacy functions are kept in `balance.legacy.server.ts`
 * and the legacy data is still being written — flipping this flag off
 * instantly rolls the read path back to the legacy implementation, no
 * schema change required.
 *
 * Default: false. Set WALLET_READ_PATH_ENABLED=true in .env after running
 * `npm run wallet:backfill` to switch the read path.
 */
export function isWalletReadPathEnabled(): boolean {
  const v = (import.meta.env?.WALLET_READ_PATH_ENABLED ?? process.env.WALLET_READ_PATH_ENABLED ?? "false")
    .toString()
    .toLowerCase()
    .trim();
  return v === "true" || v === "1" || v === "yes";
}
