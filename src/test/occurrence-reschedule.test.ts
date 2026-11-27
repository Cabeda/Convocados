/**
 * Rescheduling or re-timing a recurring occurrence must move its stored
 * deadline (nextResetAt = dateTime + durationMinutes). The advance sweep reads
 * only that deadline, so a stale one lets it replace an occurrence the
 * organizer just moved (#1764).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { advanceDueRecurringEvent } from "~/lib/advanceOccurrence.server";
import { POST as cronAdvance } from "~/pages/api/cron/advance-recurring";
import { PUT as updateDateTime } from "~/pages/api/events/[id]/datetime";
import { PUT as updateDuration } from "~/pages/api/events/[id]/duration";

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/priority.server", () => ({
  autoPriorityEnroll: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/autoConfirm.server", () => ({
  applyAutoConfirm: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/settlement.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/lib/settlement.server")>();
  return {
    ...actual,
    syncGamePayments: vi.fn().mockResolvedValue(undefined),
  };
});

const EVENT_INCLUDE = {
  teamResults: { include: { members: { orderBy: { order: "asc" as const } } } },
} as const;

let seq = 0;
const uid = (p: string) => `${p}-${++seq}-${Date.now()}`;

function putCtx(id: string, body: unknown) {
  return {
    request: new Request("http://localhost/api/test", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    params: { id },
  } as any;
}

function cronCtx(secret: string) {
  return {
    request: new Request("http://localhost/api/cron/advance-recurring", {
      method: "POST",
      headers: { authorization: `Bearer ${secret}` },
    }),
  } as any;
}

async function seedWeekly(opts: {
  dateTime: Date;
  durationMinutes?: number;
  nextResetAt?: Date;
}) {
  const durationMinutes = opts.durationMinutes ?? 60;
  const event = await prisma.event.create({
    data: {
      id: uid("evt"),
      title: "Weekly Game",
      location: "Field",
      dateTime: opts.dateTime,
      timezone: "UTC",
      maxPlayers: 10,
      durationMinutes,
      isRecurring: true,
      recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1 }),
      nextResetAt:
        opts.nextResetAt ??
        new Date(opts.dateTime.getTime() + durationMinutes * 60_000),
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({
    where: { id: event.id },
    data: { currentGameId: game.id },
  });
  return { event, game };
}

async function load(eventId: string) {
  return prisma.event.findUnique({
    where: { id: eventId },
    include: EVENT_INCLUDE,
  });
}

beforeEach(async () => {
  await prisma.scheduledJob.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  vi.clearAllMocks();
});

describe("occurrence-time writes move the stored deadline", () => {
  it("moves nextResetAt when a recurring occurrence is rescheduled", async () => {
    const start = new Date(Date.now() + 86400_000);
    const { event } = await seedWeekly({ dateTime: start, durationMinutes: 75 });
    const moved = new Date(start.getTime() + 86400_000);

    const res = await updateDateTime(putCtx(event.id, { dateTime: moved.toISOString() }));
    expect(res.status).toBe(200);

    const updated = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.dateTime.toISOString()).toBe(moved.toISOString());
    expect(updated.nextResetAt!.getTime()).toBe(moved.getTime() + 75 * 60_000);
  });

  it("moves nextResetAt and the post-game reminder when duration changes", async () => {
    const start = new Date(Date.now() + 86400_000);
    const { event } = await seedWeekly({ dateTime: start, durationMinutes: 60 });

    const res = await updateDuration(putCtx(event.id, { durationMinutes: 90 }));
    expect(res.status).toBe(200);

    const updated = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(updated.durationMinutes).toBe(90);
    expect(updated.nextResetAt!.getTime()).toBe(start.getTime() + 90 * 60_000);

    const postGame = await prisma.scheduledJob.findFirst({
      where: { eventId: event.id, type: "post_game" },
      orderBy: { runAt: "desc" },
    });
    expect(postGame?.runAt.getTime()).toBe(start.getTime() + 90 * 60_000);
  });
});

describe("the advance sweep refuses an occurrence that has not happened", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not advance a future occurrence whose stored deadline is stale", async () => {
    vi.setSystemTime(new Date("2027-01-09T20:00:00Z"));
    const { event, game } = await seedWeekly({
      dateTime: new Date("2027-01-10T19:00:00Z"),
      durationMinutes: 60,
      nextResetAt: new Date("2027-01-09T20:00:00Z"),
    });
    const loaded = (await load(event.id))!;

    const result = await advanceDueRecurringEvent(loaded);

    expect(result).toBe("not-due");
    expect(await prisma.game.count({ where: { eventId: event.id } })).toBe(1);
    expect((await prisma.game.findUniqueOrThrow({ where: { id: game.id } })).status).toBe("upcoming");
    expect(await prisma.gameHistory.count({ where: { eventId: event.id } })).toBe(0);
  });

  it("keeps the postponed Game when the old deadline arrives", async () => {
    vi.setSystemTime(new Date("2027-01-09T18:00:00Z")); // Saturday
    const { event, game } = await seedWeekly({
      dateTime: new Date("2027-01-09T19:00:00Z"),
      durationMinutes: 60,
    });
    const team = await prisma.teamResult.create({
      data: {
        eventId: event.id,
        name: "Ninjas",
        members: { create: [{ name: "Ana", order: 0 }] },
      },
    });

    // Postpone Saturday's game to Sunday.
    const sunday = new Date("2027-01-10T19:00:00Z");
    const res = await updateDateTime(putCtx(event.id, { dateTime: sunday.toISOString() }));
    expect(res.status).toBe(200);
    const postponed = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(postponed.nextResetAt!.getTime()).toBe(sunday.getTime() + 60 * 60_000);

    // The drawn Game moves with the occurrence.
    await prisma.game.update({ where: { id: game.id }, data: { dateTime: sunday } });

    // Saturday's old deadline arrives.
    vi.setSystemTime(new Date("2027-01-09T20:00:00Z"));
    vi.stubEnv("CRON_SECRET", "secret123");
    try {
      const sweep = await cronAdvance(cronCtx("secret123"));
      expect(sweep.status).toBe(200);
      expect((await sweep.json()).advanced).toBe(0);
    } finally {
      vi.unstubAllEnvs();
    }

    const atSunday = await prisma.game.findMany({
      where: { eventId: event.id, dateTime: sunday },
    });
    expect(atSunday).toHaveLength(1);
    expect(atSunday[0].id).toBe(game.id);
    expect(atSunday[0].status).toBe("upcoming");

    const fresh = await prisma.event.findUniqueOrThrow({ where: { id: event.id } });
    expect(fresh.currentGameId).toBe(game.id);
    expect(await prisma.gameHistory.count({ where: { eventId: event.id } })).toBe(0);
    expect(await prisma.teamMember.count({ where: { teamResultId: team.id } })).toBe(1);
  });
});
