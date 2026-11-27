interface TeamsSnapshotEntry {
  players?: Array<{ name?: string }>;
}

interface PaymentsSnapshotEntry {
  playerName?: string;
}

/**
 * Normalizes a name for case-insensitive, whitespace-tolerant matching.
 * Pure function — safe for both server and client usage.
 */
export function normalizeName(name: string | null | undefined): string {
  return (name ?? "").trim().toLowerCase();
}

/**
 * Parses a teamsSnapshot (stringified `[{ team, players: [{ name }] }]`)
 * into the flat list of player names. Returns [] on null or malformed input.
 */
export function namesFromTeamsSnapshot(snapshot: string | null | undefined): string[] {
  if (!snapshot) return [];
  try {
    const teams = JSON.parse(snapshot) as TeamsSnapshotEntry[];
    if (!Array.isArray(teams)) return [];
    return teams
      .flatMap((t) => t.players ?? [])
      .filter((p) => typeof p.name === "string" && p.name.trim() !== "")
      .map((p) => p.name as string);
  } catch {
    return [];
  }
}

/**
 * Checks whether a name appears on a teamsSnapshot. Case-insensitive.
 */
export function isNameInTeamsSnapshot(
  snapshot: string | null | undefined,
  name: string | null | undefined,
): boolean {
  const needle = normalizeName(name);
  if (!needle) return false;
  return namesFromTeamsSnapshot(snapshot).some((n) => normalizeName(n) === needle);
}

/**
 * Parses a paymentsSnapshot (stringified `[{ playerName, amount, status }]`)
 * into the flat list of player names. Returns [] on null or malformed input.
 */
export function namesFromPaymentsSnapshot(snapshot: string | null | undefined): string[] {
  if (!snapshot) return [];
  try {
    const payments = JSON.parse(snapshot) as PaymentsSnapshotEntry[];
    if (!Array.isArray(payments)) return [];
    return payments
      .filter((p) => typeof p.playerName === "string" && p.playerName.trim() !== "")
      .map((p) => p.playerName as string);
  } catch {
    return [];
  }
}

/**
 * Checks whether a name appears on a paymentsSnapshot. Case-insensitive.
 */
export function isNameInPaymentsSnapshot(
  snapshot: string | null | undefined,
  name: string | null | undefined,
): boolean {
  const needle = normalizeName(name);
  if (!needle) return false;
  return namesFromPaymentsSnapshot(snapshot).some((n) => normalizeName(n) === needle);
}

/**
 * Whether a user participated in a specific history entry (game), based on
 * their name appearing in that game's teamsSnapshot. This is deliberately
 * players-only — owners/admins who didn't play are NOT counted, e.g. they must
 * have played to be eligible to vote for MVP.
 */
export function isHistoryParticipant(
  history: { teamsSnapshot: string | null } | null,
  name: string | null | undefined,
): boolean {
  return isNameInTeamsSnapshot(history?.teamsSnapshot, name);
}
