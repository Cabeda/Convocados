import { prisma } from "./db.server";

/**
 * Returns the configured admin emails from env as a Set.
 * Supports comma-separated list: ADMIN_EMAIL="a@x.com,b@x.com"
 * Defaults to empty (no admins).
 */
function getAdminEmails(): Set<string> {
  const raw: string = (typeof import.meta !== "undefined" && import.meta.env?.ADMIN_EMAIL)
    ?? process.env.ADMIN_EMAIL
    ?? "";
  if (!raw) return new Set();
  return new Set(raw.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean));
}

export async function isAdmin(userId: string): Promise<boolean> {
  const emails = getAdminEmails();
  if (emails.size === 0) return false;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return !!user?.email && emails.has(user.email.toLowerCase());
}

/**
 * Check if an email is in the admin list (used client-side via API).
 */
export async function isAdminByEmail(email: string): Promise<boolean> {
  const emails = getAdminEmails();
  return emails.has(email.toLowerCase());
}

export async function getAdminStats() {
  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const [
    totalUsers,
    totalEvents,
    totalGamesPlayed,
    activeEvents,
    gamesLast7d,
    gamesLast30d,
    sportCounts,
    recurringCount,
    avgPlayersResult,
    activeUserIds,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.event.count(),
    prisma.gameHistory.count({ where: { status: "played" } }),
    prisma.event.count({ where: { dateTime: { gte: now } } }),
    prisma.gameHistory.count({ where: { status: "played", dateTime: { gte: sevenDaysAgo } } }),
    prisma.gameHistory.count({ where: { status: "played", dateTime: { gte: thirtyDaysAgo } } }),
    prisma.event.groupBy({ by: ["sport"], _count: { sport: true } }),
    prisma.event.count({ where: { isRecurring: true } }),
    prisma.event.aggregate({ _avg: { maxPlayers: true } }),
    // Active users: distinct users who have a player entry created in last 30 days
    prisma.player.findMany({
      where: { userId: { not: null }, createdAt: { gte: thirtyDaysAgo } },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);

  const sportDistribution: Record<string, number> = {};
  for (const s of sportCounts) {
    sportDistribution[s.sport] = s._count.sport;
  }

  return {
    totalUsers,
    totalEvents,
    totalGamesPlayed,
    activeEvents,
    activeUsers: activeUserIds.length,
    gamesLast7d,
    gamesLast30d,
    avgPlayersPerEvent: Math.round(avgPlayersResult._avg.maxPlayers ?? 0),
    recurringEvents: recurringCount,
    oneOffEvents: totalEvents - recurringCount,
    sportDistribution,
  };
}

export async function listUsers({ page, pageSize, search }: { page: number; pageSize: number; search?: string }) {
  const where = search
    ? { OR: [{ name: { contains: search } }, { email: { contains: search } }, { id: { contains: search } }] }
    : {};
  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      skip: (page - 1) * pageSize,
      take: pageSize,
      orderBy: { createdAt: "desc" },
    }),
    prisma.user.count({ where }),
  ]);
  return { users, total };
}

/**
 * Returns accumulated (cumulative) user and event counts per day.
 * `range`: "30d" | "1y" | "all"
 */
export async function getGrowthTimeline(range: "30d" | "1y" | "all") {
  const now = new Date();
  let since: Date | undefined;
  if (range === "30d") since = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  else if (range === "1y") since = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

  const userWhere = since ? { createdAt: { gte: since } } : {};
  const eventWhere = since ? { createdAt: { gte: since } } : {};

  const [users, events] = await Promise.all([
    prisma.user.findMany({ where: userWhere, select: { createdAt: true }, orderBy: { createdAt: "asc" } }),
    prisma.event.findMany({ where: eventWhere, select: { createdAt: true }, orderBy: { createdAt: "asc" } }),
  ]);

  // Get counts before the window for cumulative offset
  let userOffset = 0;
  let eventOffset = 0;
  if (since) {
    [userOffset, eventOffset] = await Promise.all([
      prisma.user.count({ where: { createdAt: { lt: since } } }),
      prisma.event.count({ where: { createdAt: { lt: since } } }),
    ]);
  }

  // Group by day
  const toDay = (d: Date) => d.toISOString().slice(0, 10);
  const dayMap = new Map<string, { users: number; events: number }>();

  for (const u of users) {
    const day = toDay(u.createdAt);
    const entry = dayMap.get(day) ?? { users: 0, events: 0 };
    entry.users++;
    dayMap.set(day, entry);
  }
  for (const e of events) {
    const day = toDay(e.createdAt);
    const entry = dayMap.get(day) ?? { users: 0, events: 0 };
    entry.events++;
    dayMap.set(day, entry);
  }

  // Build cumulative timeline
  const sortedDays = [...dayMap.keys()].sort();
  let cumUsers = userOffset;
  let cumEvents = eventOffset;
  const timeline: { date: string; users: number; events: number }[] = [];

  for (const day of sortedDays) {
    const entry = dayMap.get(day)!;
    cumUsers += entry.users;
    cumEvents += entry.events;
    timeline.push({ date: day, users: cumUsers, events: cumEvents });
  }

  return timeline;
}
