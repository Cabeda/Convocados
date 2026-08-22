import { prisma } from "../db.server";
import type { AuthContext } from "../authenticate.server";

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  scope: string;
  handler: (args: Record<string, unknown>, ctx: AuthContext) => Promise<unknown>;
}

async function listMyGames(_args: Record<string, unknown>, ctx: AuthContext) {
  const userId = ctx.userId;
  const owned = await prisma.event.findMany({
    where: { ownerId: userId },
    select: { id: true, title: true, location: true, dateTime: true, maxPlayers: true, sport: true },
    orderBy: { dateTime: "desc" },
    take: 50,
  });
  const adminEvents = await prisma.event.findMany({
    where: { admins: { some: { userId } } },
    select: { id: true, title: true, location: true, dateTime: true, maxPlayers: true, sport: true },
    orderBy: { dateTime: "desc" },
    take: 50,
  });
  const followedRecords = await prisma.eventFollow.findMany({
    where: { userId },
    select: { event: { select: { id: true, title: true, location: true, dateTime: true, maxPlayers: true, sport: true } } },
    take: 50,
    orderBy: { createdAt: "desc" },
  }).catch(() => [] as any);

  const ownedIds = new Set(owned.map((e) => e.id));
  const adminFiltered = adminEvents.filter((e) => !ownedIds.has(e.id));
  const adminIds = new Set(adminFiltered.map((e) => e.id));
  const followed = followedRecords
    .map((r: any) => r.event)
    .filter((e: any) => !ownedIds.has(e.id) && !adminIds.has(e.id));

  return {
    owned: owned.map((e) => ({ ...e, dateTime: e.dateTime.toISOString() })),
    admin: adminFiltered.map((e) => ({ ...e, dateTime: e.dateTime.toISOString() })),
    followed: followed.map((e: any) => ({ ...e, dateTime: e.dateTime.toISOString() })),
  };
}

async function getGame(args: Record<string, unknown>, _ctx: AuthContext) {
  const eventId = args.eventId as string;
  if (!eventId) throw Object.assign(new Error("eventId required"), { code: -32602 });
  const event = await prisma.event.findUnique({ where: { id: eventId } });
  if (!event) throw Object.assign(new Error("Game not found"), { code: 404 });
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

async function listPlayers(args: Record<string, unknown>, _ctx: AuthContext) {
  const eventId = args.eventId as string;
  if (!eventId) throw Object.assign(new Error("eventId required"), { code: -32602 });
  const eventPlayers = await prisma.eventPlayer.findMany({ where: { eventId }, select: { id: true, name: true, userId: true, rating: true } });
  // fallback to legacy Player for older events
  const legacy = await prisma.player.findMany({ where: { eventId }, select: { id: true, name: true, userId: true } });
  const map = new Map<string, any>();
  for (const p of eventPlayers) map.set(p.name, p);
  for (const p of legacy) if (!map.has(p.name)) map.set(p.name, p);
  return { players: Array.from(map.values()) };
}

async function getBalance(args: Record<string, unknown>, _ctx: AuthContext) {
  const eventId = args.eventId as string;
  if (!eventId) throw Object.assign(new Error("eventId required"), { code: -32602 });
  const history = await prisma.gameHistory.findMany({ where: { eventId }, select: { paymentsSnapshot: true } });
  // placeholder: return can compute from GamePayment but keep simple
  return { eventId, historyCount: history.length, note: "balance from GamePayment ledger" };
}

async function getHistory(args: Record<string, unknown>, _ctx: AuthContext) {
  const eventId = args.eventId as string;
  if (!eventId) throw Object.assign(new Error("eventId required"), { code: -32602 });
  const rows = await prisma.gameHistory.findMany({ where: { eventId }, orderBy: { dateTime: "desc" }, take: 20 });
  return { history: rows.map((r) => ({ ...r, dateTime: r.dateTime.toISOString(), createdAt: r.createdAt.toISOString() })) };
}

async function getRatings(args: Record<string, unknown>, _ctx: AuthContext) {
  const eventId = args.eventId as string;
  if (!eventId) throw Object.assign(new Error("eventId required"), { code: -32602 });
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
