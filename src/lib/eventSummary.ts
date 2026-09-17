/**
 * Server-rendered event summary.
 *
 * `/events/{id}` hydrates a React island (`client:only`), so its HTML body is
 * empty for any client that does not run JS. This builds the read-only facts
 * the page renders server-side, so agents and crawlers can read an event
 * without a browser (ADR 0034).
 */

export interface EventSummaryInput {
  id: string;
  title: string;
  location: string;
  dateTime: Date;
  sport: string;
  maxPlayers: number;
  playerCount: number;
  playerNames: string[];
  teams: { name: string; members: string[] }[];
  /** True when the event is password-locked; the roster is then withheld. */
  locked: boolean;
}

export interface EventSummary {
  heading: string;
  /** One-line when/where/sport. */
  meta: string;
  /** "8/10 players · 2 spot(s) left", or the lock notice. */
  attendance: string;
  /** Comma-joined active roster, or null when locked/empty. */
  players: string | null;
  /** Teams with member lists, empty when locked or unassigned. */
  teams: { name: string; members: string[] }[];
  /** JSON representation of the same resource. */
  apiPath: string;
}

/** Build the read-only summary an HTML-only client can read from the body. */
export function buildEventSummary(event: EventSummaryInput): EventSummary {
  const spotsLeft = Math.max(0, event.maxPlayers - event.playerCount);

  if (event.locked) {
    return {
      heading: event.title,
      meta: `When: ${event.dateTime.toISOString()}`,
      attendance: "Password required to view this event.",
      players: null,
      teams: [],
      apiPath: `/api/events/${event.id}`,
    };
  }

  return {
    heading: event.title,
    meta: `${event.dateTime.toISOString()} · ${event.location || "TBD"} · ${event.sport}`,
    attendance: `${event.playerCount}/${event.maxPlayers} players · ${spotsLeft} spot(s) left`,
    players: event.playerNames.length > 0 ? event.playerNames.join(", ") : null,
    teams: event.teams,
    apiPath: `/api/events/${event.id}`,
  };
}
