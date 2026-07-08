/**
 * Anonymous usage metrics derived from existing Session + UserAppOpen tables.
 * No individual tracking — only aggregated counts.
 */
import { prisma } from "./db.server";

// ponytail: parse platform from user-agent string. Intentionally coarse —
// we only care about iOS/Android/Desktop, not specific device models.
function parsePlatform(ua: string | null): "android" | "ios" | "desktop" | "unknown" {
  if (!ua) return "unknown";
  const lower = ua.toLowerCase();
  if (lower.includes("android") || lower.includes("convocados")) return "android";
  if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("ipod")) return "ios";
  if (lower.includes("mobile") && !lower.includes("android")) return "ios"; // Safari mobile
  return "desktop";
}

export interface DailyUsage {
  date: string;
  dau: number;
  android: number;
  ios: number;
  desktop: number;
}

/**
 * DAU over time from UserAppOpen (one row per user per day).
 * Platform breakdown from Session.userAgent for sessions active on that day.
 */
export async function getDailyUsage(days = 30): Promise<DailyUsage[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

  // DAU from UserAppOpen
  const appOpens = await prisma.userAppOpen.findMany({
    where: { day: { gte: since } },
    select: { userId: true, day: true },
  });

  // Get latest session per user for platform detection
  const sessions = await prisma.session.findMany({
    where: { createdAt: { gte: since } },
    select: { userId: true, userAgent: true, createdAt: true },
    orderBy: { createdAt: "desc" },
  });

  // Build user → platform map (most recent session wins)
  const userPlatform = new Map<string, "android" | "ios" | "desktop" | "unknown">();
  for (const s of sessions) {
    if (!userPlatform.has(s.userId)) {
      userPlatform.set(s.userId, parsePlatform(s.userAgent));
    }
  }

  // Group by day
  const dayMap = new Map<string, Set<string>>();
  for (const open of appOpens) {
    const day = open.day.toISOString().slice(0, 10);
    const set = dayMap.get(day) ?? new Set();
    set.add(open.userId);
    dayMap.set(day, set);
  }

  // Build result sorted by date
  const result: DailyUsage[] = [];
  const sortedDays = [...dayMap.keys()].sort();
  for (const day of sortedDays) {
    const users = dayMap.get(day)!;
    let android = 0, ios = 0, desktop = 0;
    for (const userId of users) {
      const platform = userPlatform.get(userId) ?? "unknown";
      if (platform === "android") android++;
      else if (platform === "ios") ios++;
      else if (platform === "desktop") desktop++;
      else desktop++; // unknown → desktop bucket
    }
    result.push({ date: day, dau: users.size, android, ios, desktop });
  }

  return result;
}

/** Summary stats for the current period */
export async function getUsageSummary() {
  const now = new Date();
  const today = new Date(now.toISOString().slice(0, 10));
  const sevenDaysAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [dauToday, wau, mau] = await Promise.all([
    prisma.userAppOpen.count({ where: { day: { gte: today } } }),
    prisma.userAppOpen.findMany({
      where: { day: { gte: sevenDaysAgo } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    prisma.userAppOpen.findMany({
      where: { day: { gte: thirtyDaysAgo } },
      select: { userId: true },
      distinct: ["userId"],
    }),
  ]);

  // Platform breakdown from sessions in last 30 days
  const recentSessions = await prisma.session.findMany({
    where: { createdAt: { gte: thirtyDaysAgo } },
    select: { userId: true, userAgent: true },
    distinct: ["userId"],
  });

  const platforms = { android: 0, ios: 0, desktop: 0 };
  for (const s of recentSessions) {
    const p = parsePlatform(s.userAgent);
    if (p === "android") platforms.android++;
    else if (p === "ios") platforms.ios++;
    else platforms.desktop++;
  }

  return {
    dauToday,
    wau: wau.length,
    mau: mau.length,
    platforms,
  };
}
