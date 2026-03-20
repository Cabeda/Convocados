/** Priority enrollment eligibility — pure functions, no DB dependency */

import { calculateAttendance, type AttendanceRecord } from "./attendance";

export interface PrioritySettings {
  threshold: number;   // min games attended in window
  window: number;      // last N games to evaluate
  minGames: number;    // min total games before eligible
  maxPercent: number;  // max % of maxPlayers reserved
}

export interface PriorityCandidate {
  userId: string;
  name: string;
  attendanceRate: number;
  gamesInWindow: number;
  totalGames: number;
  currentStreak: number;
  accountCreatedAt: Date;
}

export interface EligibilityResult {
  eligible: PriorityCandidate[];
  ineligible: { userId: string; name: string; reason: string }[];
}

interface HistoryEntry {
  status: string;
  dateTime: Date | string;
  teamsSnapshot: string | null;
}

interface PlayerWithAccount {
  userId: string;
  name: string;
  accountCreatedAt: Date;
  optedIn: boolean;
  declineStreak: number;
  noShowStreak: number;
}

/**
 * Calculate attendance within a sliding window of the last N games.
 * Returns the number of games attended in the window.
 */
export function gamesInWindow(
  playerName: string,
  history: HistoryEntry[],
  windowSize: number,
): number {
  const attendance = calculateAttendance(history);
  // Get the last `windowSize` games
  const totalGames = attendance.totalGames;
  if (totalGames === 0) return 0;

  // We need to re-parse to check per-game participation in the window
  const playedGames = history
    .filter((h) => h.status === "played" && h.teamsSnapshot)
    .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime());

  const windowGames = playedGames.slice(-windowSize);
  let count = 0;
  for (const game of windowGames) {
    try {
      const teams: { team: string; players: { name: string }[] }[] = JSON.parse(game.teamsSnapshot!);
      for (const team of teams) {
        if (team.players.some((p) => p.name === playerName)) {
          count++;
          break;
        }
      }
    } catch {
      continue;
    }
  }
  return count;
}

/**
 * Determine which players are eligible for priority enrollment.
 * Filters by: min games, attendance threshold in window, opt-in, no excessive declines/no-shows.
 */
export function calculateEligibility(
  history: HistoryEntry[],
  players: PlayerWithAccount[],
  settings: PrioritySettings,
): EligibilityResult {
  const attendance = calculateAttendance(history);
  const attendanceMap = new Map<string, AttendanceRecord>();
  for (const r of attendance.players) {
    attendanceMap.set(r.name, r);
  }

  const eligible: PriorityCandidate[] = [];
  const ineligible: { userId: string; name: string; reason: string }[] = [];

  for (const player of players) {
    const record = attendanceMap.get(player.name);

    // Must have played enough total games
    if (!record || record.gamesPlayed < settings.minGames) {
      ineligible.push({
        userId: player.userId,
        name: player.name,
        reason: `needs ${settings.minGames} games (played ${record?.gamesPlayed ?? 0})`,
      });
      continue;
    }

    // Must be opted in
    if (!player.optedIn) {
      ineligible.push({ userId: player.userId, name: player.name, reason: "opted out" });
      continue;
    }

    // Decay: 3 consecutive declines pauses enrollment
    if (player.declineStreak >= 3) {
      ineligible.push({ userId: player.userId, name: player.name, reason: "paused (3 consecutive declines)" });
      continue;
    }

    // No-show penalty: 2 consecutive no-shows loses priority
    if (player.noShowStreak >= 2) {
      ineligible.push({ userId: player.userId, name: player.name, reason: "lost priority (2 consecutive no-shows)" });
      continue;
    }

    // Must meet attendance threshold in window
    const windowCount = gamesInWindow(player.name, history, settings.window);
    if (windowCount < settings.threshold) {
      ineligible.push({
        userId: player.userId,
        name: player.name,
        reason: `attended ${windowCount}/${settings.window} in window (need ${settings.threshold})`,
      });
      continue;
    }

    eligible.push({
      userId: player.userId,
      name: player.name,
      attendanceRate: record.attendanceRate,
      gamesInWindow: windowCount,
      totalGames: record.gamesPlayed,
      currentStreak: record.currentStreak,
      accountCreatedAt: player.accountCreatedAt,
    });
  }

  return { eligible, ineligible };
}

/**
 * Sort eligible candidates by priority order:
 * 1. Highest attendance rate in window
 * 2. Longest active streak
 * 3. Earliest account creation (tiebreaker)
 *
 * Then cap to maxSlots.
 */
export function rankAndCap(
  candidates: PriorityCandidate[],
  maxPlayers: number,
  maxPercent: number,
): PriorityCandidate[] {
  const maxSlots = Math.floor((maxPlayers * maxPercent) / 100);
  if (maxSlots <= 0) return [];

  const sorted = [...candidates].sort((a, b) => {
    // 1. Higher attendance rate first
    if (b.attendanceRate !== a.attendanceRate) return b.attendanceRate - a.attendanceRate;
    // 2. Longer streak first
    if (b.currentStreak !== a.currentStreak) return b.currentStreak - a.currentStreak;
    // 3. Earlier account creation first
    return a.accountCreatedAt.getTime() - b.accountCreatedAt.getTime();
  });

  return sorted.slice(0, maxSlots);
}

/**
 * Calculate the confirmation deadline: N hours before the game.
 */
export function confirmationDeadline(gameDateTime: Date, deadlineHours: number): Date {
  return new Date(gameDateTime.getTime() - deadlineHours * 60 * 60 * 1000);
}
