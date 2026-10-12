import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { getDailyUsage, getUsageSummary } from "~/lib/usageMetrics.server";

function uid() { return `u-${Math.random().toString(36).slice(2, 8)}`; }
function sid() { return `s-${Math.random().toString(36).slice(2, 12)}`; }

async function seedUser(overrides: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: { id: uid(), name: "User", email: `${uid()}@t.com`, emailVerified: true, ...overrides },
  });
}

beforeEach(async () => {
  await prisma.userAppOpen.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

describe("getDailyUsage", () => {
  it("returns empty array when no app opens exist", async () => {
    const result = await getDailyUsage(7);
    expect(result).toEqual([]);
  });

  it("counts DAU per day and splits by the platform on the heartbeat row", async () => {
    const webUser = await seedUser();
    const androidUser = await seedUser();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    await prisma.userAppOpen.createMany({
      data: [
        { userId: webUser.id, day: today, platform: "web" },
        { userId: androidUser.id, day: today, platform: "android" },
      ],
    });

    // A session for the android user (e.g. the same person signed in on a
    // browser too) must not reclassify their heartbeat.
    await prisma.session.create({
      data: {
        id: sid(),
        token: sid(),
        userId: androidUser.id,
        userAgent: "Mozilla/5.0 (Macintosh) Chrome/120.0",
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });

    const result = await getDailyUsage(7);
    expect(result).toHaveLength(1);
    expect(result[0].dau).toBe(2);
    expect(result[0].android).toBe(1);
    expect(result[0].web).toBe(1);
  });

  it("does not count days outside the range", async () => {
    const user = await seedUser();
    const oldDay = new Date();
    oldDay.setDate(oldDay.getDate() - 40);
    oldDay.setHours(0, 0, 0, 0);

    await prisma.userAppOpen.create({ data: { userId: user.id, day: oldDay } });

    const result = await getDailyUsage(30);
    expect(result).toEqual([]);
  });
});

describe("getUsageSummary", () => {
  it("returns zero counts when no data exists", async () => {
    const result = await getUsageSummary();
    expect(result.dauToday).toBe(0);
    expect(result.wau).toBe(0);
    expect(result.mau).toBe(0);
    expect(result.platforms.android).toBe(0);
    expect(result.platforms.web).toBe(0);
  });

  it("computes DAU, WAU, MAU and platform/browser/os breakdown", async () => {
    const user = await seedUser();
    // Use UTC today to match getUsageSummary's `now.toISOString().slice(0,10)` logic
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

    await prisma.userAppOpen.create({ data: { userId: user.id, day: today } });
    await prisma.session.create({
      data: {
        id: sid(),
        token: sid(),
        userId: user.id,
        userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36",
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });

    const result = await getUsageSummary();
    expect(result.dauToday).toBe(1);
    expect(result.wau).toBe(1);
    expect(result.mau).toBe(1);
    expect(result.platforms.web).toBe(1);
    expect(result.platforms.android).toBe(0);
    expect(result.webDrillDown.browsers.Chrome).toBe(1);
    expect(result.webDrillDown.os.Windows).toBe(1);
  });

  it("attributes the web drill-down from the heartbeat platform, not the session UA", async () => {
    const nativeUser = await seedUser();
    const webUser = await seedUser();
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

    await prisma.userAppOpen.createMany({
      data: [
        { userId: nativeUser.id, day: today, platform: "android" },
        { userId: webUser.id, day: today, platform: "web" },
      ],
    });
    // The native client's OAuth custom tab leaves a browser-looking session;
    // the UA must not mint a web user out of a native heartbeat.
    await prisma.session.createMany({
      data: [
        {
          id: sid(),
          token: sid(),
          userId: nativeUser.id,
          userAgent: "Mozilla/5.0 (Linux; Android 10) Chrome/120.0",
          expiresAt: new Date(Date.now() + 86400_000),
        },
        {
          id: sid(),
          token: sid(),
          userId: webUser.id,
          userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36",
          expiresAt: new Date(Date.now() + 86400_000),
        },
      ],
    });

    const result = await getUsageSummary();
    expect(result.platforms.android).toBe(1);
    expect(result.webDrillDown.browsers.Chrome).toBe(1);
    expect(result.webDrillDown.os.Windows).toBe(1);
    expect(result.webDrillDown.os.Android).toBeUndefined();
  });

  it("counts a session whose user has an unknown platform as web", async () => {
    const legacyUser = await seedUser();
    const today = new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z");

    await prisma.userAppOpen.create({ data: { userId: legacyUser.id, day: today, platform: "unknown" } });
    await prisma.session.create({
      data: {
        id: sid(),
        token: sid(),
        userId: legacyUser.id,
        userAgent: "Mozilla/5.0 (Macintosh) Safari/604.1",
        expiresAt: new Date(Date.now() + 86400_000),
      },
    });

    const result = await getUsageSummary();
    expect(result.platforms.web).toBe(1);
    expect(result.webDrillDown.browsers.Safari).toBe(1);
    expect(result.webDrillDown.os.macOS).toBe(1);
  });

  // GH #1152 — a user can heartbeat on more than one client inside the window,
  // and the split used to read whichever row the `distinct` query happened to
  // return, so the bucket followed insertion order rather than evidence.
  describe("a user heartbeating on several platforms", () => {
    const day = (daysAgo: number) =>
      new Date(new Date(new Date().toISOString().slice(0, 10) + "T00:00:00.000Z").getTime() - daysAgo * 86400_000);

    /** Heartbeat `platforms` on consecutive days, in the given write order. */
    async function seedHeartbeats(platforms: string[]) {
      const user = await seedUser();
      for (const [index, platform] of platforms.entries()) {
        await prisma.userAppOpen.create({
          data: { userId: user.id, day: day(index), platform },
        });
      }
      await prisma.session.create({
        data: {
          id: sid(),
          token: sid(),
          userId: user.id,
          userAgent: "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0",
          expiresAt: new Date(Date.now() + 86400_000),
        },
      });
      return user;
    }

    it("buckets by the strongest evidence, not by the order the rows were written", async () => {
      await seedHeartbeats(["unknown", "android"]);
      await seedHeartbeats(["android", "unknown"]);

      const result = await getUsageSummary();
      // Both users carry exactly the same evidence, so they must land in the
      // same bucket: android is declared, "unknown" is not, and a declared
      // platform wins.
      expect(result.platforms.android).toBe(2);
      expect(result.platforms.web).toBe(0);
      // The browser drill-down follows the same split, and it is counted once.
      expect(result.webDrillDown.browsers.Chrome).toBeUndefined();
    });

    it("prefers a declared web platform over an undeclared one", async () => {
      await seedHeartbeats(["unknown", "web"]);

      const result = await getUsageSummary();
      expect(result.platforms.web).toBe(1);
      expect(result.webDrillDown.browsers.Chrome).toBe(1);
    });

    it("returns the same split on every call", async () => {
      await seedHeartbeats(["unknown", "ios"]);

      const runs = await Promise.all([getUsageSummary(), getUsageSummary()]);
      for (const result of runs) {
        expect(result.platforms.ios).toBe(1);
        expect(result.platforms.android).toBe(0);
        expect(result.platforms.web).toBe(0);
      }
    });

    it("counts a user once however many days they heartbeated", async () => {
      await seedHeartbeats(["android", "android", "android"]);

      const result = await getUsageSummary();
      expect(result.platforms.android).toBe(1);
      expect(result.mau).toBe(1);
    });
  });

  it("detects various browsers: Firefox, Edge, Safari, Opera, Samsung", async () => {
    const agents = [
      { ua: "Mozilla/5.0 Firefox/115.0", browser: "Firefox" },
      { ua: "Mozilla/5.0 Edg/120.0", browser: "Edge" },
      { ua: "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Safari/604.1", browser: "Safari" },
      { ua: "Mozilla/5.0 OPR/100.0", browser: "Opera" },
      { ua: "Mozilla/5.0 SamsungBrowser/23.0", browser: "Samsung" },
    ];

    for (const { ua } of agents) {
      const u = await seedUser();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await prisma.userAppOpen.create({ data: { userId: u.id, day: today } });
      await prisma.session.create({
        data: { id: sid(), token: sid(), userId: u.id, userAgent: ua, expiresAt: new Date(Date.now() + 86400_000) },
      });
    }

    const result = await getUsageSummary();
    for (const { browser } of agents) {
      expect(result.webDrillDown.browsers[browser]).toBe(1);
    }
  });

  it("detects OS variants: iOS, macOS, Linux, ChromeOS", async () => {
    const agents = [
      { ua: "Mozilla/5.0 (iPhone; CPU iPhone OS) Safari/1", os: "iOS" },
      { ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/1", os: "macOS" },
      { ua: "Mozilla/5.0 (X11; Linux x86_64) Chrome/1", os: "Linux" },
      { ua: "Mozilla/5.0 (X11; CrOS x86_64) Chrome/1", os: "ChromeOS" },
    ];

    for (const { ua } of agents) {
      const u = await seedUser();
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      await prisma.userAppOpen.create({ data: { userId: u.id, day: today } });
      await prisma.session.create({
        data: { id: sid(), token: sid(), userId: u.id, userAgent: ua, expiresAt: new Date(Date.now() + 86400_000) },
      });
    }

    const result = await getUsageSummary();
    for (const { os } of agents) {
      expect(result.webDrillDown.os[os]).toBe(1);
    }
  });
});
