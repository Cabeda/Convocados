import { prisma } from "../db.server";
import type { AuthContext } from "../authenticate.server";
import { fetchMyGames } from "../myGames.server";
import { getEventBalanceSummary } from "../balance.server";
import { McpError } from "./errors";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string;
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

async function getGame(args: Record<string, unknown>, _ctx: AuthContext) {
  const eventId = args.eventId as string;
  if (!eventId) throw new McpError("eventId required", -32602, 400);
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw new McpError("Game not found", -32001, 404);
  return {
    id: event.id,
    title: event.title,
    location: event.location,
    dateTime: event.dateTime.toISOString(),
    sport: event.sport,
    maxPlayers: event.maxPlayers,
    ownerId: event.ownerId,
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

export const TOOLS: ToolDef[] = [
  {
    name: "convocados_get_balance",
    description: "Get outstanding balance and payment summary for a Game (Event). Requires eventId.",
    inputSchema: { type: "object", properties: { eventId: { type: "string", description: "Event ID" } }, required: ["eventId"] },
    scope: "read:events",
    handler: getBalance,
  },
  {
    name: "convocados_get_game",
    description: "Get Game (Event) details by ID. Returns title, location, dateTime, sport.",
    inputSchema: { type: "object", properties: { eventId: { type: "string", description: "Event ID" } }, required: ["eventId"] },
    scope: "read:events",
    handler: getGame,
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
].sort((a, b) => a.name.localeCompare(b.name));
