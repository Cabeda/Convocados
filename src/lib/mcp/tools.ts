import type { AppScope } from "~/lib/scopes";
import { prisma } from "~/lib/db.server";
import { RSVP_STATUS_VALUES } from "~/lib/rsvp";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/** Context handed to every tool so it can build the forwarded internal request. */
export interface McpToolContext {
  userId: string;
}

/**
 * Where to send the call. A tool never performs its own side effect — it
 * re-dispatches into the existing REST route so authentication, ownership,
 * rate limiting and auditing stay in exactly one place.
 */
export interface McpCall {
  /** Path on this origin, e.g. "/api/events/abc/follow". */
  path: string;
  method: HttpMethod;
  body?: unknown;
}

export interface McpTool {
  name: string;
  description: string;
  /** JSON Schema (draft 2020-12 subset). Must be type:"object". */
  inputSchema: Record<string, unknown>;
  /**
   * OAuth scope required to call this tool.
   *
   * Omitted for player self-service tools (RSVP, claim, follow) where the
   * target route is the authority on who may act — there is no scope that
   * means "any signed-in player" and inventing one would leak into the
   * consent screen.
   */
  scope?: AppScope;
  /**
   * Optional — the MCP spec treats an absent readOnlyHint as false, so a tool
   * only states annotations worth telling a client about.
   */
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
  call(args: Record<string, unknown>, ctx: McpToolContext): McpCall | Promise<McpCall>;
}

// ── JSON Schema helpers ────────────────────────────────────────────────────

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({
  type: "object" as const,
  properties,
  ...(required.length > 0 ? { required } : {}),
  additionalProperties: false,
});

const str = (description: string, extra: Record<string, unknown> = {}) => ({
  type: "string" as const,
  description,
  ...extra,
});

const num = (description: string) => ({ type: "number" as const, description });
const bool = (description: string) => ({ type: "boolean" as const, description });
const strArray = (description: string) => ({
  type: "array" as const,
  items: { type: "string" as const },
  description,
});

const EVENT_ID = str("Event ID. Get these from list_events or get_event.");

/** Builds an object schema that always takes an `eventId` first. */
const onEvent = (properties: Record<string, unknown>, required: string[] = []) =>
  obj({ eventId: EVENT_ID, ...properties }, ["eventId", ...required]);

/** Builds a query string from defined values only. */
const qs = (params: Record<string, unknown>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
  }
  const out = search.toString();
  return out ? `?${out}` : "";
};

const eventPath = (args: Record<string, unknown>, suffix = "") =>
  `/api/events/${encodeURIComponent(String(args.eventId))}${suffix}`;

// ── update_event field → route mapping ──────────────────────────────────────

/**
 * Each editable event field lives on its own PUT route. The body key differs
 * per field (`duration` → `durationMinutes`, `visibility` → `isPublic`), so the
 * mapping is explicit rather than guessed.
 */
const EVENT_FIELDS = {
  title: { bodyKey: "title", value: str("New event title, max 100 chars.") },
  location: { bodyKey: "location", value: str("New location text. Geocoded automatically.") },
  dateTime: {
    bodyKey: "dateTime",
    value: str("New kickoff time as ISO 8601, e.g. '2026-10-07T19:00:00Z'."),
  },
  duration: { bodyKey: "durationMinutes", value: num("Game length in minutes, 0-600. 0 means unspecified.") },
  sport: { bodyKey: "sport", value: str("Sport id, e.g. 'football-5v5'.") },
  visibility: { bodyKey: "isPublic", value: bool("true = anyone with the link can view; false = access password required.") },
} as const satisfies Record<string, { bodyKey: string; value: Record<string, unknown> }>;

type EventField = keyof typeof EVENT_FIELDS;

// ── Tool table ──────────────────────────────────────────────────────────────

export const MCP_TOOLS: McpTool[] = [
  {
    name: "whoami",
    description:
      "Return the profile of the account this MCP token acts as. Call this first to confirm which user a write tool will run as.",
    inputSchema: obj({}),
    scope: "read:profile",
    annotations: { readOnlyHint: true, idempotentHint: true },
    call: () => ({ path: "/api/me/profile", method: "GET" }),
  },

  // ── Reads ────────────────────────────────────────────────────────────────
  {
    name: "list_events",
    description:
      "List the events the authenticated user owns, plays in, or follows, split into upcoming and past. This is the entry point for discovering event IDs.",
    inputSchema: obj({
      limit: num("Max events per bucket (upcoming/past). Default 20."),
      ownedCursor: str("Pagination cursor from a previous owned-page response."),
      followedCursor: str("Pagination cursor from a previous followed-page response."),
    }),
    scope: "read:events",
    annotations: { readOnlyHint: true, idempotentHint: true },
    call: (a) => ({ path: `/api/me/games${qs(a)}`, method: "GET" }),
  },

  {
    name: "get_event",
    description:
      "Full state of one event: settings, roster, team assignments and owner. Read this before mutating an event so you act on current data.",
    inputSchema: onEvent({}),
    scope: "read:events",
    annotations: { readOnlyHint: true, idempotentHint: true },
    call: (a) => ({ path: eventPath(a), method: "GET" }),
  },

  {
    name: "get_event_history",
    description:
      "Past games of an event with scores, team snapshots and MVP votes. Use this for 'how did we do last time' questions.",
    inputSchema: onEvent({
      limit: num("Max history entries to return."),
      cursor: str("Pagination cursor from a previous response."),
    }),
    scope: "read:history",
    annotations: { readOnlyHint: true, idempotentHint: true },
    call: (a) => ({ path: `${eventPath(a, "/history")}${qs({ limit: a.limit, cursor: a.cursor })}`, method: "GET" }),
  },

  {
    name: "get_my_stats",
    description:
      "Aggregate stats for the authenticated user across all events: games played, wins, ELO, payment history.",
    inputSchema: obj({}),
    scope: "read:profile",
    annotations: { readOnlyHint: true, idempotentHint: true },
    call: () => ({ path: "/api/me/stats", method: "GET" }),
  },

  {
    name: "get_payments",
    description:
      "Payment ledger for an event: per-player amounts, statuses (pending/sent/paid) and the paid/pending summary. Organizer-only.",
    inputSchema: onEvent({}),
    scope: "manage:payments",
    annotations: { readOnlyHint: true, idempotentHint: true },
    call: (a) => ({ path: `${eventPath(a, "/payments")}`, method: "GET" }),
  },

  // ── Event lifecycle ──────────────────────────────────────────────────────
  {
    name: "create_event",
    description:
      "Create a new event. Pass dateTime as ISO 8601 and always include timezone so recurring events land at the right local hour.",
    inputSchema: obj(
      {
        title: str("Event title, e.g. 'Tuesday 5v5'. Max 100 chars."),
        dateTime: str("Kickoff time as ISO 8601, e.g. '2026-10-07T19:00:00Z'."),
        location: str("Where the game is played. Geocoded for the map."),
        timezone: str("IANA timezone name, e.g. 'Europe/Madrid'. Defaults to UTC."),
        sport: str("Sport id, e.g. 'football-5v5'."),
        maxPlayers: num("Roster size, 2-100. Defaults to 10."),
        teamOneName: str("Name for team one. Defaults to 'Ninjas'."),
        teamTwoName: str("Name for team two. Defaults to 'Gunas'."),
        isPublic: bool("true = anyone with the link can view; false = access password required."),
        isRecurring: bool("true = repeats on a schedule."),
        recurrenceFreq: str("Recurrence period.", { enum: ["daily", "weekly", "monthly", "yearly"] }),
        recurrenceInterval: num("Repeat every N periods. Defaults to 1."),
        recurrenceByDay: str("Weekday for weekly recurrence, e.g. 'MO'."),
      },
      ["title", "dateTime"],
    ),
    scope: "create:events",
    annotations: { idempotentHint: false },
    call: (a) => ({ path: "/api/events", method: "POST", body: a }),
  },

  {
    name: "update_event",
    description:
      "Change one setting on an event the caller organises. Field-specific, so it cannot silently overwrite unrelated settings.",
    inputSchema: onEvent(
      {
        field: str("Which setting to change.", {
          enum: Object.keys(EVENT_FIELDS),
        }),
        value: {
          description:
            "New value. Must match the field: string for title/location/dateTime/sport, number for duration, boolean for visibility.",
        },
        timezone: str("IANA timezone. Only used when field is 'dateTime'."),
      },
      ["field", "value"],
    ),
    scope: "write:events",
    annotations: { idempotentHint: true },
    call: (a) => {
      const field = String(a.field) as EventField;
      const spec = EVENT_FIELDS[field];
      if (!spec) {
        throw new Error(
          `Unknown field "${String(a.field)}". Expected one of: ${Object.keys(EVENT_FIELDS).join(", ")}`,
        );
      }
      const body: Record<string, unknown> = { [spec.bodyKey]: a.value };
      if (field === "dateTime" && a.timezone !== undefined) body.timezone = a.timezone;
      return { path: `${eventPath(a, `/${field}`)}`, method: "PUT", body };
    },
  },

  {
    name: "cancel_event",
    description:
      "Cancel an upcoming game or event. Cancels scheduled reminders and notifies players. Do not call to reschedule — use update_event with field 'dateTime'.",
    inputSchema: onEvent({}),
    scope: "write:events",
    annotations: { destructiveHint: true, idempotentHint: true },
    call: (a) => ({ path: `${eventPath(a, "/cancel")}`, method: "PUT" }),
  },

  // ── Roster ───────────────────────────────────────────────────────────────
  {
    name: "claim_player",
    description:
      "Claim an existing unlinked roster slot for the authenticated user. Use after finding your name in the roster of an event you now want to join.",
    inputSchema: onEvent(
      { playerId: str("The roster slot to claim. Read it from get_event.") },
      ["playerId"],
    ),
    annotations: { idempotentHint: true },
    call: (a) => ({ path: `${eventPath(a, "/claim-player")}`, method: "POST", body: { playerId: a.playerId } }),
  },

  {
    name: "add_player",
    description:
      "Add a player to an event's roster by name, optionally linking them to an existing account so they get notified. Organizer-only.",
    inputSchema: onEvent(
      {
        name: str("Player name to add."),
        linkToAccount: bool("Link the roster slot to a matching existing account."),
        email: str("Email of the account to link. Requires linkToAccount."),
      },
      ["name"],
    ),
    scope: "manage:players",
    call: (a) => ({ path: `${eventPath(a, "/players")}`, method: "POST", body: a }),
  },

  {
    name: "remove_player",
    description:
      "Remove a player from an event's roster. Organizer-only. To leave an event you play in, use leave_event instead.",
    inputSchema: onEvent(
      { playerId: str("Roster slot to remove. Read it from get_event.") },
      ["playerId"],
    ),
    scope: "manage:players",
    annotations: { destructiveHint: true },
    call: (a) => ({
      path: `${eventPath(a, "/players")}`,
      method: "DELETE",
      body: { playerId: a.playerId },
    }),
  },

  {
    name: "leave_event",
    description:
      "Leave an event you are a player in. Archives your roster slot, declines your RSVP and unfollows you.",
    inputSchema: onEvent({}),
    annotations: { destructiveHint: true },
    call: (a) => ({ path: `${eventPath(a, "/leave")}`, method: "POST" }),
  },

  {
    name: "rsvp",
    description: "Answer the RSVP for the next game of an event you play in.",
    inputSchema: onEvent(
      { status: str("Your answer.", { enum: [...RSVP_STATUS_VALUES] }) },
      ["status"],
    ),
    annotations: { idempotentHint: true },
    call: (a) => ({ path: `${eventPath(a, "/rsvp")}`, method: "POST", body: { status: a.status } }),
  },

  {
    name: "set_no_show",
    description:
      "Mark or unmark a player as a no-show for a specific game. Affects their attendance stats and ELO. Organizer-only.",
    inputSchema: onEvent(
      {
        gameId: str("Game ID. Read it from get_event."),
        eventPlayerId: str("Event player ID being marked. Read it from get_event."),
        noShow: bool("true = no-show, false = undo the mark."),
      },
      ["gameId", "eventPlayerId", "noShow"],
    ),
    scope: "manage:players",
    annotations: { idempotentHint: true },
    call: (a) => ({
      path: `${eventPath(a, "/no-show")}`,
      method: "POST",
      body: { gameId: a.gameId, eventPlayerId: a.eventPlayerId, noShow: a.noShow },
    }),
  },

  // ── Teams ────────────────────────────────────────────────────────────────
  {
    name: "randomize_teams",
    description:
      "Split the active roster into two teams at random, or balanced by ELO when balanced is true. Overwrites any existing team assignment.",
    inputSchema: onEvent({
      balanced: bool("true = balance by ELO rating; false = pure random. Default false."),
    }),
    scope: "manage:teams",
    call: (a) => ({
      path: `${eventPath(a, "/randomize")}${qs({ balanced: a.balanced === true })}`,
      method: "POST",
    }),
  },

  {
    name: "set_teams",
    description:
      "Assign specific players to specific teams. Every supplied player ID must belong to the event and none may repeat.",
    inputSchema: onEvent(
      {
        teamOnePlayerIds: strArray("Player IDs for team one."),
        teamTwoPlayerIds: strArray("Player IDs for team two."),
      },
      ["teamOnePlayerIds", "teamTwoPlayerIds"],
    ),
    scope: "manage:teams",
    annotations: { idempotentHint: true },
    call: (a) => ({
      path: `${eventPath(a, "/teams")}`,
      method: "PATCH",
      body: {
        teamOnePlayerIds: a.teamOnePlayerIds,
        teamTwoPlayerIds: a.teamTwoPlayerIds,
      },
    }),
  },

  // ── Money ────────────────────────────────────────────────────────────────
  {
    name: "set_cost",
    description:
      "Set the total cost for the next game and how it is split between players. Omit optional fields to leave them unchanged.",
    inputSchema: onEvent(
      {
        totalAmount: num("Total cost for the game in major currency units, e.g. 30 for EUR 30."),
        currency: str("ISO currency code. Defaults to EUR."),
        paymentDetails: str("Free-text payment instructions shown to players."),
        paymentMethods: strArray("Accepted payment methods, e.g. ['Bizum', 'Revolut']."),
        monthlyEnabled: bool("Enable monthly subscriptions instead of per-game payment."),
        monthlyFeeCents: num("Monthly fee in cents. Requires monthlyEnabled."),
        dropInSurchargeCents: num("Extra cents charged to drop-in players."),
      },
      ["totalAmount"],
    ),
    scope: "manage:payments",
    call: (a) => ({ path: `${eventPath(a, "/cost")}`, method: "PUT", body: a }),
  },

  {
    name: "mark_payment",
    description:
      "Set the payment status of one player. status is pending (unpaid), sent (player says they paid) or paid (organizer confirmed).",
    inputSchema: onEvent(
      {
        playerName: str("Player whose payment to update. Must match the roster name exactly."),
        status: str("New payment status.", { enum: ["pending", "sent", "paid"] }),
        method: str("Payment method used, e.g. 'Bizum'."),
      },
      ["playerName", "status"],
    ),
    scope: "manage:payments",
    annotations: { idempotentHint: true },
    call: (a) => ({
      path: `${eventPath(a, "/payments")}`,
      method: "PUT",
      body: { playerName: a.playerName, status: a.status, method: a.method },
    }),
  },

  // ── Follow ───────────────────────────────────────────────────────────────
  {
    name: "follow_event",
    description:
      "Follow an event you do not play in, to receive event-change and recruitment notifications. Playing in an event already implies following it.",
    inputSchema: onEvent({}),
    annotations: { idempotentHint: true },
    call: (a) => ({ path: `${eventPath(a, "/follow")}`, method: "POST" }),
  },

  {
    name: "unfollow_event",
    description: "Stop following an event. Only valid while you do not play in it.",
    inputSchema: onEvent({}),
    annotations: { destructiveHint: true, idempotentHint: true },
    call: (a) => ({ path: `${eventPath(a, "/follow")}`, method: "DELETE" }),
  },

  // ── Results ──────────────────────────────────────────────────────────────
  {
    name: "post_result",
    description:
      "Record the result of a played game: scores and the team lineup. The lineup defaults to the event's current teams, so pass teamsSnapshot only to override it.",
    inputSchema: onEvent(
      {
        dateTime: str("When the game was played, ISO 8601. Defaults to the event's kickoff."),
        scoreOne: num("Goals/points scored by team one."),
        scoreTwo: num("Goals/points scored by team two."),
        teamOneName: str("Override team one's display name for this game."),
        teamTwoName: str("Override team two's display name for this game."),
        teamsSnapshot: {
          type: "array",
          description:
            "Team lineup override: [{ team: string, players: [{ name: string, order: number }] }]. Defaults to the current teams.",
          items: {
            type: "object",
            properties: {
              team: { type: "string" },
              players: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, order: { type: "number" } },
                  required: ["name", "order"],
                },
              },
            },
            required: ["team", "players"],
          },
        },
      },
      ["scoreOne", "scoreTwo"],
    ),
    scope: "write:events",
    call: async (a) => {
      const eventId = String(a.eventId);
      const event = await prisma.event.findUnique({
        where: { id: eventId },
        select: { teamOneName: true, teamTwoName: true, dateTime: true, teamResults: { include: { members: true } } },
      });
      // ponytail: only two reads for defaults that the route would reject anyway;
      // a full snapshot fetch belongs here rather than in the LLM's tool args.
      const teamsSnapshot =
        (a.teamsSnapshot as unknown) ?? event?.teamResults.map((tr) => ({
          team: tr.name,
          players: tr.members.map((m) => ({ name: m.name, order: m.order })),
        }));
      return {
        path: `/api/events/${encodeURIComponent(eventId)}/history`,
        method: "POST",
        body: {
          dateTime: a.dateTime ?? event?.dateTime?.toISOString(),
          teamOneName: a.teamOneName ?? event?.teamOneName ?? "Team One",
          teamTwoName: a.teamTwoName ?? event?.teamTwoName ?? "Team Two",
          scoreOne: a.scoreOne,
          scoreTwo: a.scoreTwo,
          // The route stores this as a JSON string.
          teamsSnapshot: typeof teamsSnapshot === "string" ? teamsSnapshot : JSON.stringify(teamsSnapshot ?? []),
        },
      };
    },
  },
];

export const MCP_TOOLS_BY_NAME = new Map(MCP_TOOLS.map((tool) => [tool.name, tool]));