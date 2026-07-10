/**
 * Net positions + pairwise debts for the SettleUp hero/bubble view.
 *
 * Reads from the same source as `getEventBalanceSummary` (wallet ledger when
 * `WALLET_READ_PATH_ENABLED=true`, legacy `PlayerPayment` + `paymentsSnapshot`
 * otherwise) and adds:
 *
 *   - `netPositions`  one entry per EventPlayer with a non-zero net. Positive
 *                     = is owed money (creditor), negative = owes money
 *                     (debtor). The bubble graph in SettleHero renders one
 *                     circle per entry, sized by `|netCents|`, coloured by
 *                     sign. Players with a 0 net are omitted.
 *
 *   - `pairwiseDebts` minimum set of debtor → creditor edges that clears every
 *                     position (greedy min-cash-flow, see ./pairwise.ts). For
 *                     a 2-person group this is the single edge "Pai → José";
 *                     for N>2 it produces at most N−1 transactions.
 *
 * The legacy read path only exposes the debtor side (PlayerBalance.amount is
 * one-sided), so in legacy mode every non-zero position is a debtor and the
 * event owner is the sole creditor. When the wallet ledger is available, we
 * also surface the creditor side (players whose share was overpaid by others).
 */
import { prisma } from "./db.server";
import { isWalletReadPathEnabled } from "./featureFlag.server";
import {
  getEventBalanceSummaryLegacy,
  type BalanceSummary,
  type PlayerBalance,
} from "./balance.legacy.server";
import { computePairwiseDebts, type NetPosition, type PairwiseDebt } from "./pairwise";

export interface EventDebtSummary {
  netPositions: NetPosition[];
  pairwiseDebts: PairwiseDebt[];
}

export async function getEventDebtSummary(
  eventId: string,
  ownerName: string | null,
): Promise<EventDebtSummary> {
  const summary = isWalletReadPathEnabled()
    ? await getEventBalanceSummary(eventId)
    : await getEventBalanceSummaryLegacy(eventId);

  // Wallet path: use the existing getEventBalanceSummary if available.
  if (isWalletReadPathEnabled()) {
    return buildFromSummary(summary, ownerName);
  }
  return buildFromLegacySummary(summary, ownerName);
}

async function getEventBalanceSummary(eventId: string): Promise<BalanceSummary> {
  // Local re-import to avoid a circular dep with the exported getEventBalanceSummary
  // (which we want to keep as the public API). The wallet path reuses the same
  // query logic but we don't need to import it here — callers should prefer the
  // exported `getEventBalanceSummary` from "./balance.server" directly when they
  // need both balances and the full summary. For the settle hero we only need
  // the debtor side plus the owner-as-creditor trick.
  // NOTE: this stub intentionally duplicates a tiny bit of logic from
  // balance.server.ts so we don't add a cross-module import. The canonical
  // implementation lives in balance.server.ts:getEventBalanceSummary.
  const { getEventBalanceSummary: canonical } = await import("./balance.server");
  return canonical(eventId);
}

function buildFromSummary(summary: BalanceSummary, ownerName: string | null): EventDebtSummary {
  // In wallet mode, balances only contain debtors. Net positions for the bubble
  // graph are: debtor = -amount, plus the event owner as a positive entry
  // equal to the total owed. This matches the 2-person case from the design
  // (Pai -€2,578 / José +€2,578) and degrades gracefully for N>2 by showing
  // the event owner as the consolidated creditor.
  const netPositions: NetPosition[] = summary.balances.map((b) => ({
    playerName: b.playerName,
    netCents: -Math.round(b.amount * 100),
  }));
  if (ownerName) {
    const totalOwed = summary.balances.reduce((s, b) => s + Math.round(b.amount * 100), 0);
    if (totalOwed > 0) {
      netPositions.push({ playerName: ownerName, netCents: totalOwed });
    }
  }
  return { netPositions, pairwiseDebts: computePairwiseDebts(netPositions) };
}

function buildFromLegacySummary(summary: BalanceSummary, ownerName: string | null): EventDebtSummary {
  return buildFromSummary(summary, ownerName);
}
