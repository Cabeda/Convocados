/**
 * Pairwise debt computation.
 *
 * Given a list of net positions (positive = is owed money, negative = owes
 * money), produce the minimum set of debtor → creditor edges that clears
 * every position. Uses the standard greedy min-cash-flow algorithm:
 * repeatedly pair the largest debtor with the largest creditor until both
 * queues are empty. For N players this produces at most N−1 transactions
 * (and in practice far fewer than the N×(N−1) naïve bound).
 */
export interface NetPosition {
  playerName: string;
  netCents: number;
}

export interface PairwiseDebt {
  fromName: string;
  toName: string;
  amountCents: number;
}

const EPSILON_CENTS = 1;

export function computePairwiseDebts(positions: NetPosition[]): PairwiseDebt[] {
  // Defensive copy. Filter out zero/epsilon positions and normalise sign.
  const debtors: NetPosition[] = [];
  const creditors: NetPosition[] = [];
  for (const p of positions) {
    if (p.netCents > EPSILON_CENTS) {
      creditors.push({ playerName: p.playerName, netCents: p.netCents });
    } else if (p.netCents < -EPSILON_CENTS) {
      debtors.push({ playerName: p.playerName, netCents: -p.netCents });
    }
  }
  if (debtors.length === 0 || creditors.length === 0) return [];

  // Sort largest first so we always pair the biggest remaining amounts.
  debtors.sort((a, b) => b.netCents - a.netCents);
  creditors.sort((a, b) => b.netCents - a.netCents);

  const debts: PairwiseDebt[] = [];
  let i = 0;
  let j = 0;
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i];
    const creditor = creditors[j];
    const amount = Math.min(debtor.netCents, creditor.netCents);
    if (amount > EPSILON_CENTS) {
      debts.push({ fromName: debtor.playerName, toName: creditor.playerName, amountCents: amount });
    }
    debtor.netCents -= amount;
    creditor.netCents -= amount;
    if (debtor.netCents <= EPSILON_CENTS) i++;
    if (creditor.netCents <= EPSILON_CENTS) j++;
  }
  return debts;
}
