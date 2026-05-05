import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST as createEvent } from "~/pages/api/events/index";
import { PUT as updateDateTime } from "~/pages/api/events/[id]/datetime";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/push.server", () => ({
  sendPushToEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/email.server", () => ({
  sendReminder: vi.fn().mockResolvedValue(undefined),
  sendPaymentReminder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(0),
}));

beforeEach(async () => {
  await prisma.scheduledJob.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

function postCtx(body: unknown) {
  return {
    request: new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: {},
    url: new URL("http://localhost/api/events"),
  } as any;
}

function putCtx(id: string, body: unknown) {
  return {
    request: new Request(`http://localhost/api/events/${id}/datetime`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id },
    url: new URL(`http://localhost/api/events/${id}/datetime`),
  } as any;
}

describe("Event creation schedules reminders", () => {
  it("creates scheduled reminder jobs when an event is created", async () => {
    const res = await createEvent(postCtx({
      title: "Test Game",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
      timezone: "UTC",
      sport: "football-5v5",
    }));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBeDefined();

    const jobs = await prisma.scheduledJob.findMany({
      where: { eventId: body.id },
      orderBy: { runAt: "asc" },
    });

    expect(jobs).toHaveLength(4);
    expect(jobs.map((j) => j.type)).toEqual([
      "reminder_24h",
      "reminder_2h",
      "reminder_1h",
      "post_game",
    ]);
  });
});

describe("Event datetime update reschedules reminders", () => {
  it("reschedules reminder jobs when datetime is updated", async () => {
    const createRes = await createEvent(postCtx({
      title: "Test Game",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString(),
      timezone: "UTC",
      sport: "football-5v5",
    }));
    const { id: eventId } = await createRes.json();

    const originalJobs = await prisma.scheduledJob.findMany({
      where: { eventId },
      orderBy: { runAt: "asc" },
    });
    expect(originalJobs).toHaveLength(4);
    const originalRunAts = originalJobs.map((j) => j.runAt.getTime());

    const newDateTime = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const updateRes = await updateDateTime(putCtx(eventId, {
      dateTime: newDateTime.toISOString(),
    }));
    expect(updateRes.status).toBe(200);

    const newJobs = await prisma.scheduledJob.findMany({
      where: { eventId },
      orderBy: { runAt: "asc" },
    });
    expect(newJobs).toHaveLength(4);

    // All runAt times should have changed
    const newRunAts = newJobs.map((j) => j.runAt.getTime());
    for (let i = 0; i < originalRunAts.length; i++) {
      expect(newRunAts[i]).not.toBe(originalRunAts[i]);
    }

    // 24h reminder should be at newDateTime - 24h
    const ms24h = 24 * 60 * 60 * 1000;
    expect(Math.abs(newJobs[0].runAt.getTime() - (newDateTime.getTime() - ms24h))).toBeLessThan(1000);
  });
});
