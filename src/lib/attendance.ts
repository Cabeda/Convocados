/** Attendance calculation logic — pure functions, no DB dependency */

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

interface TeamSnapshot {
  team: string;
  players: { name: string; order: number }[];
}

interface HistoryEntry {
  status: string;
  dateTime: Date | string;
  teamsSnapshot: string | null;
}

/**
 * Calculate attendance stats from game history entries.
 * Only counts games with status "played" and valid teamsSnapshot.
 * Entries must be sorted by dateTime ascending (oldest first).
 */
export function calculateAttendance(history: HistoryEntry[]): AttendanceResult {
  // Filter to played games with valid snapshots, sorted chronologically
  const playedGames = history
    .filter((h) => h.status === "played" && h.teamsSnapshot)
    .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

  const totalGames = playedGames.length;
  if (totalGames === 0) return { players: [], totalGames: 0 };

  // Parse each game's players
  const gameParticipants: { dateTime: string; players: Set<string> }[] = [];
  for (const game of playedGames) {
    try {
      const teams: TeamSnapshot[] = JSON.parse(game.teamsSnapshot!);
      const players = new Set<string>();
      for (const team of teams) {
        for (const p of team.players) {
          players.add(p.name);
        }
      }
      gameParticipants.push({
        dateTime: new Date(game.dateTime).toISOString(),
        players,
      });
    } catch {
      // Skip malformed JSON
      continue;
    }
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
    let tempStreak = 0;
    for (const g of gameParticipants) {
      if (g.players.has(name)) {
        gamesPlayed++;
        tempStreak++;
        lastPlayed = g.dateTime;
      } else {
        tempStreak = 0;
      }
    }
    currentStreak = tempStreak;

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
