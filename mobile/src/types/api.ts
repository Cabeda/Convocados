/** Shared API types — mirrors the server responses */

export interface EventSummary {
  id: string;
  title: string;
  location: string;
  dateTime: string;
  sport: string;
  maxPlayers: number;
  playerCount: number;
  archivedAt: string | null;
  isRecurring?: boolean;
}

export interface EventDetail {
  id: string;
  title: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  dateTime: string;
  timezone: string;
  maxPlayers: number;
  teamOneName: string;
  teamTwoName: string;
  sport: string;
  durationMinutes: number;
  isPublic: boolean;
  isRecurring: boolean;
  recurrenceRule: string | null;
  nextResetAt: string | null;
  ownerId: string | null;
  ownerName: string | null;
  isAdmin: boolean;
  hasPassword: boolean;
  eloEnabled: boolean;
  splitCostsEnabled: boolean;
  balanced: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  players: Player[];
  teamResults?: TeamResult[];
  wasReset?: boolean;
  locked?: boolean;
}

export interface Player {
  id: string;
  name: string;
  order: number;
  userId: string | null;
  createdAt: string;
}

export interface TeamResult {
  id: string;
  name: string;
  members: TeamMember[];
}

export interface TeamMember {
  id: string;
  name: string;
  order: number;
}

export interface GameHistory {
  id: string;
  dateTime: string;
  status: "played" | "cancelled";
  scoreOne: number | null;
  scoreTwo: number | null;
  teamOneName: string;
  teamTwoName: string;
  teamsSnapshot: string | null;
  paymentsSnapshot: string | null;
  editableUntil: string;
  createdAt: string;
  editable: boolean;
  source: "live" | "historical";
  eloUpdates: { name: string; delta: number }[] | null;
}

export interface MyGamesResponse {
  owned: EventSummary[];
  joined: EventSummary[];
  archivedOwned: EventSummary[];
  archivedJoined: EventSummary[];
  ownedNextCursor: string | null;
  ownedHasMore: boolean;
  joinedNextCursor: string | null;
  joinedHasMore: boolean;
}

export interface PlayerStats {
  summary: {
    totalGames: number;
    totalWins: number;
    totalDraws: number;
    totalLosses: number;
    winRate: number;
    avgRating: number;
    bestRating: number;
    eventsPlayed: number;
  };
  events: EventStats[];
}

export interface EventStats {
  eventId: string;
  eventTitle: string;
  sport: string;
  rating: number;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  winRate: number;
  attendance: {
    gamesPlayed: number;
    totalGames: number;
    attendanceRate: number;
    currentStreak: number;
  } | null;
}

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface OAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // unix timestamp ms
}

/** Event status (lightweight polling endpoint) */
export interface EventStatus {
  id: string;
  title: string;
  location: string;
  dateTime: string;
  maxPlayers: number;
  teamOneName: string;
  teamTwoName: string;
  isRecurring: boolean;
  nextResetAt: string | null;
  players: {
    active: { id: string; name: string }[];
    bench: { id: string; name: string }[];
    total: number;
    spotsLeft: number;
  };
  teams: { name: string; players: string[] }[];
}

/** Attendance record for a player */
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

/** Known player for autocomplete suggestions */
export interface KnownPlayer {
  name: string;
  gamesPlayed: number;
}

/** Public event for discovery */
export interface PublicEvent {
  id: string;
  title: string;
  location: string;
  latitude: number | null;
  longitude: number | null;
  sport: string;
  dateTime: string;
  maxPlayers: number;
  playerCount: number;
  spotsLeft: number;
}

/** ELO player rating */
export interface PlayerRating {
  id: string;
  name: string;
  rating: number;
  initialRating: number | null;
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
}

/** Payment entry */
export interface Payment {
  id: string;
  playerName: string;
  amount: number;
  status: "paid" | "pending";
  method: string | null;
  paidAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PaymentSummary {
  paidCount: number;
  pendingCount: number;
  totalCount: number;
  paidAmount: number;
}

export interface PaymentsResponse {
  payments: Payment[];
  summary: PaymentSummary;
  currency?: string;
  totalAmount?: number;
}

/** Post-game status */
export interface PostGameStatus {
  gameEnded: boolean;
  hasScore: boolean;
  hasCost: boolean;
  allPaid: boolean;
  allComplete: boolean;
  isParticipant: boolean;
  latestHistoryId: string | null;
  paymentsSnapshot: Array<{ playerName: string; amount: number; status: string; method?: string | null }> | null;
  costCurrency: string | null;
  costAmount: number | null;
  hasPendingPastPayments: boolean;
}

/** Notification preferences */
export interface NotificationPrefs {
  emailEnabled: boolean;
  pushEnabled: boolean;
  gameInviteEmail: boolean;
  gameInvitePush: boolean;
  gameReminderEmail: boolean;
  gameReminderPush: boolean;
  playerActivityPush: boolean;
  eventDetailsPush: boolean;
  weeklySummaryEmail: boolean;
  paymentReminderEmail: boolean;
  paymentReminderPush: boolean;
  reminder24h: boolean;
  reminder2h: boolean;
  reminder1h: boolean;
}

/** Event log entry */
export interface EventLogEntry {
  id: string;
  action: string;
  actorName: string | null;
  details: string | null;
  createdAt: string;
}

/** User public profile */
export interface UserPublicProfile {
  id: string;
  name: string;
  image: string | null;
  stats: {
    totalGames: number;
    totalWins: number;
    totalDraws: number;
    totalLosses: number;
    winRate: number;
    avgRating: number;
  } | null;
}

/** Pending score sync for offline-first watch */
export interface PendingScoreSync {
  eventId: string;
  historyId: string;
  scoreOne: number;
  scoreTwo: number;
  timestamp: number;
}
