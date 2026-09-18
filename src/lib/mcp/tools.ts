import { prisma } from "../db.server";
import type { AuthContext } from "../authenticate.server";
import { fetchMyGames } from "../myGames.server";
import { getEventBalanceSummary } from "../balance.server";
import { McpError } from "./errors";
import { WRITE_TOOLS } from "./writeTools";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string;
  /**
   * When true (default), `tools/call` requires a valid OAuth token. Set false
   * for tools that anonymous callers may use (read-only public data).
   */
  requiresAuth?: boolean;
  handler: (args: Record<string, unknown>, ctx: AuthContext) => Promise<unknown>;
}

async function listMyGames(_args: Record<string, unknown>, ctx: AuthContext) {
  const result = await fetchMyGames(ctx.userId, 50);
  // Return only active games for MCP simplicity; strip archived variants
  return {
    owned: result.owned,
    admin: result.admin,
    followed: result.followed,
    ownedHasMore: result.ownedHasMore,
    followedHasMore: result.followedHasMore,
  };
}

async function getGame(args: Record<string, unknown>, ctx: AuthContext) {
  const eventId = args.eventId as string;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new McpError("Game not found", -32001, 404);

  // Anonymous callers get link-accessible events, but a password-locked event
  // reveals only its title (ADR 0034).
  if (event.accessPassword && !ctx.userId) {
    return { id: event.id, title: event.title, locked: true, hasPassword: true };
  }

  const playerCount = event.currentGameId
    ? await prisma.gameParticipant.count({ where: { gameId: event.currentGameId, archivedAt: null } })
    : await prisma.player.count({ where: { eventId, archivedAt: null } });

  return {
    id: event.id,
    title: event.title,
    location: event.location,
    dateTime: event.dateTime.toISOString(),
    sport: event.sport,
    maxPlayers: event.maxPlayers,
    playerCount,
    spotsLeft: Math.max(0, event.maxPlayers - playerCount),
    ownerId: event.ownerId,
    isPublic: event.isPublic,
  };
}

/** Anonymous read: discover public (discoverable) events. */
async function listPublicEvents(args: Record<string, unknown>) {
  const raw = Number(args.limit);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 20;
  const events = await prisma.event.findMany({
    where: { isPublic: true, archivedAt: null },
    orderBy: { dateTime: "asc" },
    take: limit,
    select: {
      id: true, title: true, location: true, dateTime: true,
      sport: true, maxPlayers: true,
    },
  });
  return {
    events: events.map((e) => ({ ...e, dateTime: e.dateTime.toISOString(), url: `/events/${e.id}` })),
  };
}

type PlayerLike = { id: string; name: string; userId: string | null; rating?: number };
async function listPlayers(args: Record<string, unknown>, _ctx: AuthContext) {
  const eventId = args.eventId as string;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const eventPlayers = await prisma.eventPlayer.findMany({ where: { eventId }, select: { id: true, name: true, userId: true, rating: true } });
  // fallback to legacy Player for older events
  const legacy = await prisma.player.findMany({ where: { eventId }, select: { id: true, name: true, userId: true } });
  const map = new Map<string, PlayerLike>();
  for (const p of eventPlayers) map.set(p.name, p);
  for (const p of legacy) if (!map.has(p.name)) map.set(p.name, { ...p, rating: undefined });
  return { players: Array.from(map.values()) };
}

async function getBalance(args: Record<string, unknown>, _ctx: AuthContext) {
  const eventId = args.eventId as string;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const event = await prisma.event.findUnique({ where: { id: eventId }, select: { id: true } });
  if (!event) throw new McpError("Game not found", -32001, 404);
  const summary = await getEventBalanceSummary(eventId);
  return {
    eventId,
    paidCount: summary.paidCount,
    totalCount: summary.totalCount,
    balances: summary.balances,
    aggregate: `${summary.paidCount}/${summary.totalCount} paid`,
  };
}

async function getHistory(args: Record<string, unknown>, _ctx: AuthContext) {
  const eventId = args.eventId as string;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const rows = await prisma.gameHistory.findMany({ where: { eventId }, orderBy: { dateTime: "desc" }, take: 20 });
  return { history: rows.map((r) => ({ ...r, dateTime: r.dateTime.toISOString(), createdAt: r.createdAt.toISOString() })) };
}

async function getRatings(args: Record<string, unknown>, _ctx: AuthContext) {
  const eventId = args.eventId as string;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const ratings = await prisma.playerRating.findMany({ where: { eventId } });
  const fallback = ratings.length ? ratings : await prisma.eventPlayer.findMany({ where: { eventId }, select: { name: true, rating: true, gamesPlayed: true, wins: true, losses: true } });
  return { ratings: fallback };
}

const READ_TOOLS: ToolDef[] = [
  {
    name: "convocados_get_balance",
    description: "Get outstanding balance and payment summary for a Game (Event). Requires eventId.",
    inputSchema: { type: "object", properties: { eventId: { type: "string", description: "Event ID" } }, required: ["eventId"] },
    scope: "read:events",
    handler: getBalance,
  },
  {
    name: "convocados_get_game",
    description: "Get Game (Event) details by ID: title, location, dateTime, sport, players, spots left. Anonymous; a password-locked event returns { locked: true }.",
    inputSchema: { type: "object", properties: { eventId: { type: "string", description: "Event ID" } }, required: ["eventId"] },
    scope: "read:events",
    requiresAuth: false,
    handler: getGame,
  },
  {
    name: "convocados_list_public_events",
    description: "List public (discoverable) Games looking for players. Anonymous; no arguments required.",
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "Max results (1-50, default 20)" } }, additionalProperties: false },
    scope: "read:events",
    requiresAuth: false,
    handler: listPublicEvents,
  },
  {
    name: "convocados_get_history",
    description: "Get game history for an Event (past Games). Requires eventId.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"] },
    scope: "read:history",
    handler: getHistory,
  },
  {
    name: "convocados_get_ratings",
    description: "Get ELO ratings for an Event. Requires eventId.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"] },
    scope: "read:ratings",
    handler: getRatings,
  },
  {
    name: "convocados_list_my_games",
    description: "List authenticated user's Games (owned, admin, followed). No arguments.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    scope: "read:events",
    handler: listMyGames,
  },
  {
    name: "convocados_list_players",
    description: "List players for a Game (Event). Requires eventId.",
    inputSchema: { type: "object", properties: { eventId: { type: "string" } }, required: ["eventId"] },
    scope: "read:events",
    handler: listPlayers,
  },
];

export const TOOLS: ToolDef[] = [...READ_TOOLS, ...WRITE_TOOLS].sort((a, b) => a.name.localeCompare(b.name));
