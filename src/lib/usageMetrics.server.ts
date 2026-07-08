/**
 * Anonymous usage metrics derived from existing Session + UserAppOpen tables.
 * No individual tracking — only aggregated counts.
 *
 * Platform split: Android (native app) vs Web (everything else).
 * Web drill-down: browser (Chrome, Safari, Firefox, etc.) + OS (Windows, macOS, Linux, iOS, Android).
 */
import { prisma } from "./db.server";

// ponytail: "android" = native app (user-agent contains "Convocados" or specific
// Android WebView patterns from the native app's Ktor client). Everything else = web.
function isAndroidApp(ua: string | null): boolean {
  if (!ua) return false;
  const lower = ua.toLowerCase();
  // The native Android app uses Ktor which includes "ktor" or the app sets a custom UA with "Convocados"
  return lower.includes("convocados") || (lower.includes("ktor") && lower.includes("android"));
}

function parseBrowser(ua: string | null): string {
  if (!ua) return "Unknown";
  if (ua.includes("Firefox/") || ua.includes("FxiOS/")) return "Firefox";
  if (ua.includes("Edg/") || ua.includes("EdgA/") || ua.includes("EdgiOS/")) return "Edge";
  if (ua.includes("OPR/") || ua.includes("Opera/")) return "Opera";
  if (ua.includes("SamsungBrowser/")) return "Samsung";
  if (ua.includes("CriOS/") || ua.includes("Chrome/")) return "Chrome";
  if (ua.includes("Safari/") && !ua.includes("Chrome/")) return "Safari";
  return "Other";
}

function parseOS(ua: string | null): string {
  if (!ua) return "Unknown";
  const lower = ua.toLowerCase();
  if (lower.includes("iphone") || lower.includes("ipad") || lower.includes("ipod")) return "iOS";
  if (lower.includes("android")) return "Android";
  if (lower.includes("windows")) return "Windows";
  if (lower.includes("mac os") || lower.includes("macintosh")) return "macOS";
  if (lower.includes("linux") && !lower.includes("android")) return "Linux";
  if (lower.includes("cros")) return "ChromeOS";
  return "Other";
}

export interface DailyUsage {
  date: string;
  dau: number;
  android: number;
  web: number;
}

export interface WebDrillDown {
  browsers: Record<string, number>;
  os: Record<string, number>;
}

/**
 * DAU over time from UserAppOpen (one row per user per day).
 * Platform breakdown: Android (native) vs Web.
 */
export async function getDailyUsage(days = 30): Promise<DailyUsage[]> {
  const since = new Date();
  since.setDate(since.getDate() - days);
  since.setHours(0, 0, 0, 0);

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

  const userIsAndroid = new Map<string, boolean>();
  for (const s of sessions) {
    if (!userIsAndroid.has(s.userId)) {
      userIsAndroid.set(s.userId, isAndroidApp(s.userAgent));
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

  const result: DailyUsage[] = [];
  const sortedDays = [...dayMap.keys()].sort();
  for (const day of sortedDays) {
    const users = dayMap.get(day)!;
    let android = 0, web = 0;
    for (const userId of users) {
      if (userIsAndroid.get(userId)) android++;
      else web++;
    }
    result.push({ date: day, dau: users.size, android, web });
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

  // Platform + web drill-down from sessions in last 30 days
  const recentSessions = await prisma.session.findMany({
    where: { createdAt: { gte: thirtyDaysAgo } },
    select: { userId: true, userAgent: true },
    distinct: ["userId"],
  });

  const platforms = { android: 0, web: 0 };
  const webDrillDown: WebDrillDown = { browsers: {}, os: {} };

  for (const s of recentSessions) {
    if (isAndroidApp(s.userAgent)) {
      platforms.android++;
    } else {
      platforms.web++;
      const browser = parseBrowser(s.userAgent);
      const os = parseOS(s.userAgent);
      webDrillDown.browsers[browser] = (webDrillDown.browsers[browser] ?? 0) + 1;
      webDrillDown.os[os] = (webDrillDown.os[os] ?? 0) + 1;
    }
  }

  return {
    dauToday,
    wau: wau.length,
    mau: mau.length,
    platforms,
    webDrillDown,
  };
}
