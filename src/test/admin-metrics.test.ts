import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { getDailyUsage, getUsageSummary } from "~/lib/usageMetrics.server";
import { recordAppOpen } from "~/lib/rsvp.server";

function utcDay(offsetDays = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + offsetDays));
}

async function seedUser() {
  return prisma.user.create({
    data: {
      id: `u-${Math.random().toString(36).slice(2, 10)}`,
      name: "Metrics",
      email: `${Math.random().toString(36).slice(2, 10)}@t.com`,
      emailVerified: true,
    },
  });
}

async function seedOpen(userId: string, offsetDays: number, platform: string | null) {
  await prisma.userAppOpen.create({ data: { userId, day: utcDay(offsetDays), platform } });
}

beforeEach(async () => {
  await prisma.userAppOpen.deleteMany();
  await prisma.session.deleteMany();
  await prisma.user.deleteMany();
});

describe("recordAppOpen platform", () => {
  it("stores the platform and never overwrites an existing non-null platform", async () => {
    const user = await seedUser();
    await recordAppOpen(user.id, new Date(), "web");
    await recordAppOpen(user.id, new Date(), "android");

    const rows = await prisma.userAppOpen.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe("web");
  });

  it("fills a null platform from a later native heartbeat", async () => {
    const user = await seedUser();
    await seedOpen(user.id, 0, null);
    await recordAppOpen(user.id, new Date(), "ios");

    const row = await prisma.userAppOpen.findUniqueOrThrow({
      where: { userId_day: { userId: user.id, day: utcDay(0) } },
    });
    expect(row.platform).toBe("ios");
  });
});

describe("getUsageSummary", () => {
  it("splits platforms from the heartbeat rows, not sessions", async () => {
    const android = await seedUser();
    const ios = await seedUser();
    const web = await seedUser();
    await seedOpen(android.id, 0, "android");
    await seedOpen(ios.id, 0, "ios");
    await seedOpen(web.id, 0, "web");
    // A session with a web UA for the android user must not reclassify them.
    await prisma.session.create({
      data: { id: `s-${android.id}`, userId: android.id, token: `t-${android.id}`, expiresAt: new Date(Date.now() + 86_400_000), userAgent: "Mozilla/5.0 (Chrome)" },
    });

    const summary = await getUsageSummary();
    expect(summary.platforms.android).toBe(1);
    expect(summary.platforms.ios).toBe(1);
    expect(summary.platforms.web).toBe(1);
  });

  it("counts WAU over the trailing 7 days inclusive of today", async () => {
    const inWindow = await seedUser();
    const boundaryIn = await seedUser();
    const tooOld = await seedUser();
    await seedOpen(inWindow.id, 0, "web");
    await seedOpen(boundaryIn.id, -6, "web"); // 6 days ago = oldest day in a 7-day window
    await seedOpen(tooOld.id, -7, "web");     // 7 days ago = outside

    const summary = await getUsageSummary();
    expect(summary.wau).toBe(2);
  });

  it("counts MAU over the trailing 30 days inclusive of today", async () => {
    const inside = await seedUser();
    const boundaryIn = await seedUser();
    const tooOld = await seedUser();
    await seedOpen(inside.id, 0, "web");
    await seedOpen(boundaryIn.id, -29, "web"); // 29 days ago = oldest day in a 30-day window
    await seedOpen(tooOld.id, -30, "web");     // outside

    const summary = await getUsageSummary();
    expect(summary.mau).toBe(2);
  });

  it("counts DAU for today only", async () => {
    const today = await seedUser();
    const yesterday = await seedUser();
    await seedOpen(today.id, 0, "web");
    await seedOpen(yesterday.id, -1, "web");

    const summary = await getUsageSummary();
    expect(summary.dauToday).toBe(1);
  });
});

describe("getDailyUsage", () => {
  it("reports per-day platform buckets and excludes days before the window", async () => {
    const a = await seedUser();
    const b = await seedUser();
    const c = await seedUser();
    await seedOpen(a.id, 0, "android");
    await seedOpen(b.id, 0, "ios");
    await seedOpen(c.id, 0, "web");
    await seedOpen(a.id, -1, "android");
    // Outside a 30-day window.
    const old = await seedUser();
    await seedOpen(old.id, -40, "web");

    const usage = await getDailyUsage(30);
    const days = usage.map((d) => d.date);
    expect(days).toContain(utcDay(0).toISOString().slice(0, 10));
    expect(days).toContain(utcDay(-1).toISOString().slice(0, 10));
    expect(days).not.toContain(utcDay(-40).toISOString().slice(0, 10));

    const today = usage.find((d) => d.date === utcDay(0).toISOString().slice(0, 10))!;
    expect(today.dau).toBe(3);
    expect(today.android).toBe(1);
    expect(today.ios).toBe(1);
    expect(today.web).toBe(1);
  });

  it("treats pre-column (null platform) heartbeats as web", async () => {
    const u = await seedUser();
    await seedOpen(u.id, 0, null);

    const [today] = await getDailyUsage(7);
    expect(today.web).toBe(1);
    expect(today.android).toBe(0);
  });
});
