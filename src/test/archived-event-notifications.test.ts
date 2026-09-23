/**
 * Regression: archived events must never produce notifications.
 *
 * Bug (prod): an archived recurring Event kept sending the owner (cabeda)
 * reminders/post-game pushes. Two compounding causes:
 *   1. The lazy recurrence reset in GET /api/events/[id] advanced an archived
 *      event's dateTime forever, re-scheduling reminders and resetting dedup
 *      flags on every visit after the occurrence passed.
 *   2. The cron scan helpers (reminders, RSVP, recruitment) and the scheduled
 *      job processor never filtered on `archivedAt`, so any archived event
 *      still in a notification window kept firing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const mockGetSession = vi.fn().mockResolvedValue(null);
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: vi.fn().mockResolvedValue({
    isOwner: true,
    isAdmin: false,
    session: { user: { id: "owner1", name: "Cabeda" } },
  }),
  checkEventAdmin: vi.fn().mockResolvedValue(false),
}));

vi.mock("~/lib/geocode", () => ({
  resolveLocation: vi.fn().mockResolvedValue(null),
}));

import { GET as getEvent } from "~/pages/api/events/[id]/index";
import { PUT as archiveEvent } from "~/pages/api/events/[id]/archive";
import { getUpcomingReminders, getPostGameReminders } from "~/lib/reminders.server";
import {
  getEventsNeedingRsvpPing,
  getEventsNeedingRsvpSummary,
  getEventsNeedingRecruitment48h,
  getEventsNeedingRecruitment24h,
} from "~/lib/rsvp.server";
import { processJob } from "~/lib/scheduler.server";

function ctx(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: body !== undefined ? "PUT" : "GET",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

const HOUR = 3600_000;

async function seedOwner() {
  await prisma.user.upsert({
    where: { id: "owner1" },
    create: { id: "owner1", name: "Cabeda", email: "cabeda@test.com", emailVerified: true },
    update: {},
  });
}

async function seedEvent(opts: {
  id?: string;
  dateTime: Date;
  archivedAt?: Date | null;
  isRecurring?: boolean;
  nextResetAt?: Date | null;
  rsvpCutoffSent?: boolean;
}) {
  return prisma.event.create({
    data: {
      id: opts.id,
      title: "Archived Series",
      location: "Pitch",
      dateTime: opts.dateTime,
      ownerId: "owner1",
      durationMinutes: 60,
      isRecurring: opts.isRecurring ?? false,
      recurrenceRule: opts.isRecurring
        ? JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" })
        : null,
      nextResetAt: opts.nextResetAt ?? null,
      archivedAt: opts.archivedAt ?? null,
      rsvpCutoffSent: opts.rsvpCutoffSent ?? false,
    },
  });
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.notificationJob.deleteMany();
  await prisma.scheduledJob.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  await seedOwner();
});

describe("archived events are excluded from reminder scans", () => {
  it("getUpcomingReminders skips an archived event in the 24h window", async () => {
    const soon = new Date(Date.now() + 23.5 * HOUR);
    await seedEvent({ id: "arch-24h", dateTime: soon, archivedAt: new Date() });
    await seedEvent({ id: "live-24h", dateTime: soon });

    const reminders = await getUpcomingReminders("24h");
    expect(reminders.map((r) => r.eventId)).not.toContain("arch-24h");
    expect(reminders.map((r) => r.eventId)).toContain("live-24h");
  });

  it("getPostGameReminders skips an archived event that just ended", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * HOUR);
    await seedEvent({ id: "arch-post", dateTime: twoHoursAgo, archivedAt: new Date() });
    await seedEvent({ id: "live-post", dateTime: twoHoursAgo });

    const reminders = await getPostGameReminders();
    expect(reminders.map((r) => r.eventId)).not.toContain("arch-post");
    expect(reminders.map((r) => r.eventId)).toContain("live-post");
  });
});

describe("archived events are excluded from RSVP / recruitment scans", () => {
  it("getEventsNeedingRsvpPing skips archived events at T-48h", async () => {
    const in48h = new Date(Date.now() + 48 * HOUR);
    await seedEvent({ id: "arch-rsvp", dateTime: in48h, archivedAt: new Date() });
    await seedEvent({ id: "live-rsvp", dateTime: in48h });

    const ids = (await getEventsNeedingRsvpPing()).map((e) => e.id);
    expect(ids).not.toContain("arch-rsvp");
    expect(ids).toContain("live-rsvp");
  });

  it("getEventsNeedingRsvpSummary skips archived events at T-24h", async () => {
    const in24h = new Date(Date.now() + 24 * HOUR);
    await seedEvent({
      id: "arch-sum", dateTime: in24h, archivedAt: new Date(), rsvpCutoffSent: true,
    });
    await seedEvent({ id: "live-sum", dateTime: in24h, rsvpCutoffSent: true });

    const ids = (await getEventsNeedingRsvpSummary()).map((e) => e.id);
    expect(ids).not.toContain("arch-sum");
    expect(ids).toContain("live-sum");
  });

  it("getEventsNeedingRecruitment48h skips archived events", async () => {
    const in48h = new Date(Date.now() + 48 * HOUR);
    await seedEvent({
      id: "arch-rec48", dateTime: in48h, archivedAt: new Date(), rsvpCutoffSent: true,
    });
    await seedEvent({ id: "live-rec48", dateTime: in48h, rsvpCutoffSent: true });

    const ids = (await getEventsNeedingRecruitment48h()).map((e) => e.id);
    expect(ids).not.toContain("arch-rec48");
    expect(ids).toContain("live-rec48");
  });

  it("getEventsNeedingRecruitment24h skips archived events", async () => {
    const in24h = new Date(Date.now() + 24 * HOUR);
    await seedEvent({
      id: "arch-rec24", dateTime: in24h, archivedAt: new Date(), rsvpCutoffSent: true,
    });
    await seedEvent({ id: "live-rec24", dateTime: in24h, rsvpCutoffSent: true });

    const ids = (await getEventsNeedingRecruitment24h()).map((e) => e.id);
    expect(ids).not.toContain("arch-rec24");
    expect(ids).toContain("live-rec24");
  });
});

describe("scheduled jobs for archived events do not notify", () => {
  it("processJob skips a due reminder job for an archived event", async () => {
    const event = await seedEvent({
      id: "arch-job", dateTime: new Date(Date.now() + 20 * HOUR), archivedAt: new Date(),
    });
    const job = await prisma.scheduledJob.create({
      data: {
        eventId: event.id,
        type: "reminder_24h",
        runAt: new Date(Date.now() - 60_000),
        payload: "{}",
      },
    });

    await processJob(job.id);

    expect(await prisma.notificationJob.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.reminderLog.count({ where: { eventId: event.id } })).toBe(0);
  });
});

describe("archiving stops recurrence and cancels pending jobs", () => {
  it("does not advance an archived recurring event's dateTime on GET", async () => {
    const pastDate = new Date(Date.now() - 2 * 86400_000);
    const event = await seedEvent({
      id: "arch-recur",
      dateTime: pastDate,
      isRecurring: true,
      nextResetAt: new Date(pastDate.getTime() + HOUR),
      archivedAt: new Date(),
    });
    const game1 = await prisma.game.create({
      data: { eventId: event.id, dateTime: pastDate },
    });
    await prisma.event.update({
      where: { id: event.id },
      data: { currentGameId: game1.id },
    });

    const res = await getEvent(ctx({ id: event.id }));
    const body = await res.json();
    expect(body.wasReset).toBe(false);

    const after = await prisma.event.findUnique({ where: { id: event.id } });
    expect(after!.dateTime.getTime()).toBe(pastDate.getTime());
    expect(after!.currentGameId).toBe(game1.id);
    expect(await prisma.game.count({ where: { eventId: event.id } })).toBe(1);
    expect(await prisma.scheduledJob.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("archive endpoint cancels pending scheduled jobs", async () => {
    const event = await seedEvent({
      id: "arch-cancel", dateTime: new Date(Date.now() + 20 * HOUR),
    });
    await prisma.scheduledJob.createMany({
      data: [
        { eventId: event.id, type: "reminder_24h", runAt: new Date(Date.now() + HOUR), payload: "{}" },
        { eventId: event.id, type: "reminder_2h", runAt: new Date(Date.now() + 18 * HOUR), payload: "{}" },
      ],
    });

    const res = await archiveEvent(ctx({ id: event.id }, { archive: true }));
    expect(res.status).toBe(200);

    const pending = await prisma.scheduledJob.count({
      where: { eventId: event.id, processedAt: null },
    });
    expect(pending).toBe(0);
  });
});
