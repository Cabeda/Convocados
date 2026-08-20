export interface Player {
  id: string;
  name: string;
  userId?: string | null;
  image?: string | null;
  /** ADR 0025: ISO timestamp when the player opted out of invites for this event. */
  invitationOptOutAt?: string | null;
}

export interface TeamMember {
  name: string;
  order: number;
}

export interface TeamResult {
  id: string;
  name: string;
  members: TeamMember[];
}

export interface EventData {
  id: string;
  title: string;
  location: string;
  dateTime: string;
  timezone: string;
  maxPlayers: number;
  durationMinutes: number;
  teamOneName: string;
  teamTwoName: string;
  isRecurring: boolean;
  isPublic: boolean;
  balanced: boolean;
  eloEnabled: boolean;
  hideEloInTeams: boolean;
  showCompetitiveData: boolean;
  splitCostsEnabled: boolean;
  mvpEnabled: boolean;
  mvpEloEnabled: boolean;
  sport: string;
  recurrenceRule: string | null;
  ownerId: string | null;
  ownerName: string | null;
  players: Player[];
  teamResults: TeamResult[];
  wasReset?: boolean;
  hasPassword?: boolean;
  locked?: boolean;
  archivedAt?: string | null;
  isAdmin?: boolean;
  latitude?: number | null;
  longitude?: number | null;
  courtWatchConfig?: string | null;
  gameStatus?: string | null;
  /** ADR 0025: players who declined (rsvp=no) the current game. Server-gated —
   *  only participants/owner/admins receive a non-empty array. */
  declined?: Array<{ id: string; name: string; userId: string | null; image: string | null }>;
  /** ADR 0025: pending PlayerInvite entries for the current game. Server-gated —
   *  only participants/owner/admins (or the invitee themselves) see a non-empty array. */
  invited?: Array<{ id: string; name: string; userId: string | null; image: string | null }>;
}

export interface KnownPlayer {
  name: string;
  gamesPlayed?: number;
  /** When non-null, the suggestion matches a registered user account by name. */
  userId?: string | null;
  /** Profile image of the linked user account, if any. */
  image?: string | null;
}

/** Option type for the player Autocomplete: either an existing player or a "create new" action. */
export type PlayerOption =
  | { type: "existing"; name: string; gamesPlayed: number; userId: string | null; image?: string | null }
  | { type: "create"; name: string };
