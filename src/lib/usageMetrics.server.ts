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
  ios: number;
  web: number;
}

export interface WebDrillDown {
  browsers: Record<string, number>;
  os: Record<string, number>;
}

/** UTC midnight for the given instant. */
function utcDay(at: Date = new Date()): Date {
  return new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));
}

/** A heartbeat's platform bucket. Pre-column rows (null) counted as web. */
function bucket(platform: string | null): "android" | "ios" | "web" {
  return platform === "android" || platform === "ios" ? platform : "web";
}

/**
 * DAU over time from UserAppOpen (one row per user per day) and the platform
 * recorded on the row itself. Windows are UTC-day based to match the stored
 * `day` values exactly.
 */
export async function getDailyUsage(days = 30): Promise<DailyUsage[]> {
  // `days` calendar days including today → start (days - 1) days before today.
  const since = new Date(utcDay().getTime() - (days - 1) * 24 * 60 * 60 * 1000);

  const appOpens = await prisma.userAppOpen.findMany({
    where: { day: { gte: since } },
    select: { userId: true, day: true, platform: true },
  });

  // Group by day: one entry per user (the row is unique per user/day).
  const dayMap = new Map<string, Map<string, "android" | "ios" | "web">>();
  for (const open of appOpens) {
    const day = open.day.toISOString().slice(0, 10);
    const users = dayMap.get(day) ?? new Map();
    users.set(open.userId, bucket(open.platform));
    dayMap.set(day, users);
  }

  const result: DailyUsage[] = [];
  const sortedDays = [...dayMap.keys()].sort();
  for (const day of sortedDays) {
    const users = dayMap.get(day)!;
    let android = 0, ios = 0, web = 0;
    for (const platform of users.values()) {
      if (platform === "android") android++;
      else if (platform === "ios") ios++;
      else web++;
    }
    result.push({ date: day, dau: users.size, android, ios, web });
  }

  return result;
}

/** Summary stats for the current period (UTC-day windows). */
export async function getUsageSummary() {
  const today = utcDay();
  // Trailing windows INCLUSIVE of today: WAU = 7 days, MAU = 30 days.
  const sevenDaysAgo = new Date(today.getTime() - 6 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(today.getTime() - 29 * 24 * 60 * 60 * 1000);

  const [dauToday, wauRows, mauRows] = await Promise.all([
    prisma.userAppOpen.count({ where: { day: today } }),
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

  // Platform split from the heartbeat rows' own platform column (native clients
  // create no session, so user-agent inference is impossible for them).
  const platformRows = await prisma.userAppOpen.findMany({
    where: { day: { gte: thirtyDaysAgo } },
    select: { userId: true, platform: true },
    distinct: ["userId"],
  });

  const platforms = { android: 0, ios: 0, web: 0 };
  for (const row of platformRows) {
    platforms[bucket(row.platform)]++;
  }

  // Web drill-down (browser/OS) still comes from sessions — it only concerns
  // browser clients. Native users have no session and are not counted here.
  const recentSessions = await prisma.session.findMany({
    where: { createdAt: { gte: thirtyDaysAgo } },
    select: { userId: true, userAgent: true },
    distinct: ["userId"],
  });

  const webDrillDown: WebDrillDown = { browsers: {}, os: {} };
  for (const s of recentSessions) {
    if (isAndroidApp(s.userAgent)) continue;
    const browser = parseBrowser(s.userAgent);
    const os = parseOS(s.userAgent);
    webDrillDown.browsers[browser] = (webDrillDown.browsers[browser] ?? 0) + 1;
    webDrillDown.os[os] = (webDrillDown.os[os] ?? 0) + 1;
  }

  return {
    dauToday,
    wau: wauRows.length,
    mau: mauRows.length,
    platforms,
    webDrillDown,
  };
}
