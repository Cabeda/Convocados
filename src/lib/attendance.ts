/** Attendance calculation logic — pure functions, no DB dependency */

import { namesFromTeamsSnapshot } from "./snapshotParticipants";

export interface AttendanceRecord {
  name: string;
  gamesPlayed: number;
  totalGames: number;
  attendanceRate: number;
  currentStreak: number;
  lastPlayed: string | null;
}

export interface AttendanceResult {
  players: AttendanceRecord[];
  totalGames: number;
}

interface HistoryEntry {
  status: string;
  dateTime: Date | string;
  teamsSnapshot: string | null;
  /** Who-played names from the durable Game roster. When set, wins over the snapshot. */
  playerNames?: string[];
}

/**
 * Who played this occurrence: the durable Game-derived names when the caller
 * supplied them, else the frozen teamsSnapshot (mrcokrf9).
 */
function playedNames(entry: HistoryEntry): string[] {
  if (entry.playerNames) return entry.playerNames;
  return namesFromTeamsSnapshot(entry.teamsSnapshot);
}

/**
 * Calculate attendance stats from game history entries.
 * Only counts games with status "played" and a resolvable roster.
 * Entries must be sorted by dateTime ascending (oldest first).
 */
export function calculateAttendance(history: HistoryEntry[]): AttendanceResult {
  // Filter to played games with a roster, sorted chronologically
  const playedGames = history
    .filter((h) => h.status === "played")
    .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

  const totalGames = playedGames.length;
  if (totalGames === 0) return { players: [], totalGames: 0 };

  // Parse each game's players
  const gameParticipants: { dateTime: string; players: Set<string> }[] = [];
  for (const game of playedGames) {
    const names = playedNames(game);
    if (names.length === 0) continue;
    gameParticipants.push({
      dateTime: new Date(game.dateTime).toISOString(),
      players: new Set(names),
    });
  }

  const effectiveTotal = gameParticipants.length;
  if (effectiveTotal === 0) return { players: [], totalGames: 0 };

  // Collect all unique player names
  const allPlayers = new Set<string>();
  for (const g of gameParticipants) {
    for (const name of g.players) allPlayers.add(name);
  }

  // Calculate stats per player
  const records: AttendanceRecord[] = [];
  for (const name of allPlayers) {
    let gamesPlayed = 0;
    let currentStreak = 0;
    let lastPlayed: string | null = null;

    // Walk games in chronological order to compute streak
    for (const g of gameParticipants) {
      if (g.players.has(name)) {
        gamesPlayed++;
        currentStreak++;
        lastPlayed = g.dateTime;
      } else {
        currentStreak = 0;
      }
    }

    records.push({
      name,
      gamesPlayed,
      totalGames: effectiveTotal,
      attendanceRate: Math.round((gamesPlayed / effectiveTotal) * 100) / 100,
      currentStreak,
      lastPlayed,
    });
  }

  // Sort by attendance rate descending, then by name
  records.sort((a, b) => b.attendanceRate - a.attendanceRate || a.name.localeCompare(b.name));

  return { players: records, totalGames: effectiveTotal };
}
