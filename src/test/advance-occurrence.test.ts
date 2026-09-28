/**
 * Eager occurrence advance (issue #1176): the lazy reset extracted from the
 * event GET handler into a shared module, plus a cron sweep so recurring
 * events advance (and re-arm reminders/webhooks) without waiting for a visit.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { advanceDueRecurringEvent } from "~/lib/advanceOccurrence.server";
import { POST as cronAdvance } from "~/pages/api/cron/advance-recurring";
import { fireWebhooks } from "~/lib/webhook.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/priority.server", () => ({
  autoPriorityEnroll: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/autoConfirm.server", () => ({
  applyAutoConfirm: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/settlement.server", () => ({
  syncGamePayments: vi.fn().mockResolvedValue(undefined),
}));

const EVENT_INCLUDE = {
  teamResults: { include: { members: { orderBy: { order: "asc" as const } } } },
} as const;

let seq = 0;
const uid = (p: string) => `${p}-${++seq}-${Date.now()}`;

async function seedRecurring(
  opts: { due?: boolean; archived?: boolean } = {},
) {
  const user = await prisma.user.create({
    data: {
      id: uid("user"),
      name: "Sweep User",
      email: `${uid("mail")}@test.com`,
      emailVerified: true,
    },
  });
  const event = await prisma.event.create({
    data: {
      id: uid("evt"),
      title: "Recurring Game",
      location: "Field",
      dateTime: new Date(Date.now() - 3 * 3600_000),
      maxPlayers: 10,
      ownerId: user.id,
      durationMinutes: 60,
      isRecurring: true,
      recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1 }),
      nextResetAt:
        opts.due === false
          ? new Date(Date.now() + 3600_000)
          : new Date(Date.now() - 3600_000),
      archivedAt: opts.archived ? new Date() : null,
      rsvpCutoffSent: true,
      recruitment48hSent: true,
      recruitment24hSent: true,
    },
  });
  const game = await prisma.game.create({
    data: { eventId: event.id, dateTime: event.dateTime, status: "upcoming" },
  });
  await prisma.event.update({
    where: { id: event.id },
    data: { currentGameId: game.id },
  });
  return { user, event, game };
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
  await prisma.player.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

describe("advanceDueRecurringEvent", () => {
  it("advances a due occurrence: date, game pointer, snapshots, flags, re-armed reminders, webhook", async () => {
    const { event: seeded, game } = await seedRecurring();
    const event = (await load(seeded.id))!;

    const result = await advanceDueRecurringEvent(event);

    expect(result).toBe("advanced");
    const fresh = await prisma.event.findUnique({ where: { id: seeded.id } });
    expect(fresh!.dateTime.getTime()).toBeGreaterThan(Date.now());
    expect(fresh!.nextResetAt!.getTime()).toBeGreaterThan(Date.now());
    expect(fresh!.currentGameId).not.toBe(game.id);
    expect(fresh!.rsvpCutoffSent).toBe(false);
    expect(fresh!.recruitment48hSent).toBe(false);
    expect(fresh!.recruitment24hSent).toBe(false);

    const oldGame = await prisma.game.findUnique({ where: { id: game.id } });
    expect(oldGame!.status).toBe("played");
    expect(await prisma.gameHistory.count({ where: { eventId: seeded.id } })).toBe(1);

    // Reminders re-armed for the new occurrence (cancel old + schedule new)
    const jobs = await prisma.scheduledJob.findMany({ where: { eventId: seeded.id } });
    expect(jobs.length).toBeGreaterThanOrEqual(3);
    expect(jobs.every((j) => j.runAt.getTime() > Date.now())).toBe(true);

    expect(fireWebhooks).toHaveBeenCalledWith(
      seeded.id,
      "game_reset",
      expect.objectContaining({ newDateTime: expect.any(String) }),
    );
  });

  it("returns not-due for a future occurrence and leaves state untouched", async () => {
    const { event: seeded, game } = await seedRecurring({ due: false });
    const event = (await load(seeded.id))!;

    expect(await advanceDueRecurringEvent(event)).toBe("not-due");

    const fresh = await prisma.event.findUnique({ where: { id: seeded.id } });
    expect(fresh!.dateTime.getTime()).toBe(seeded.dateTime.getTime());
    expect(fresh!.currentGameId).toBe(game.id);
    expect(await prisma.gameHistory.count({ where: { eventId: seeded.id } })).toBe(0);
  });

  it("never advances an archived occurrence", async () => {
    const { event: seeded } = await seedRecurring({ archived: true });
    const event = (await load(seeded.id))!;

    expect(await advanceDueRecurringEvent(event)).toBe("not-due");
    const fresh = await prisma.event.findUnique({ where: { id: seeded.id } });
    expect(fresh!.dateTime.getTime()).toBe(seeded.dateTime.getTime());
  });

  it("returns not-due when the recurrence rule is missing", async () => {
    const { event: seeded } = await seedRecurring();
    await prisma.event.update({
      where: { id: seeded.id },
      data: { recurrenceRule: null },
    });
    const event = (await load(seeded.id))!;

    expect(await advanceDueRecurringEvent(event)).toBe("not-due");
    expect(await prisma.gameHistory.count({ where: { eventId: seeded.id } })).toBe(0);
  });

  it("concurrent callers advance exactly once (CAS)", async () => {
    const { event: seeded } = await seedRecurring();
    // Both callers hold the same pre-advance snapshot — the CAS must let
    // exactly one through even though both see the occurrence as due.
    const snapshot = (await load(seeded.id))!;
    const [a, b] = await Promise.all([
      advanceDueRecurringEvent(snapshot),
      advanceDueRecurringEvent(snapshot),
    ]);

    expect([a, b].sort()).toEqual(["advanced", "concurrent"]);
    expect(await prisma.gameHistory.count({ where: { eventId: seeded.id } })).toBe(1);
    expect(await prisma.game.count({ where: { eventId: seeded.id } })).toBe(2);
  });
});

describe("POST /api/cron/advance-recurring", () => {
  function ctx(secret?: string) {
    return {
      request: new Request("http://localhost/api/cron/advance-recurring", {
        method: "POST",
        headers: secret ? { authorization: `Bearer ${secret}` } : {},
      }),
    } as any;
  }

  it("rejects 401 when CRON_SECRET is unset (fail-closed)", async () => {
    const res = await cronAdvance(ctx());
    expect(res.status).toBe(401);
  });

  it("rejects 401 on wrong secret", async () => {
    vi.stubEnv("CRON_SECRET", "secret123");
    try {
      const res = await cronAdvance(ctx("wrong"));
      expect(res.status).toBe(401);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("advances due recurring events and skips future and archived ones", async () => {
    vi.stubEnv("CRON_SECRET", "secret123");
    try {
      const due = await seedRecurring();
      const future = await seedRecurring({ due: false });
      const archived = await seedRecurring({ archived: true });

      const res = await cronAdvance(ctx("secret123"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.ok).toBe(true);
      expect(body.advanced).toBe(1);

      const dueFresh = await prisma.event.findUnique({ where: { id: due.event.id } });
      expect(dueFresh!.dateTime.getTime()).toBeGreaterThan(Date.now());
      const futureFresh = await prisma.event.findUnique({ where: { id: future.event.id } });
      expect(futureFresh!.dateTime.getTime()).toBe(future.event.dateTime.getTime());
      const archivedFresh = await prisma.event.findUnique({ where: { id: archived.event.id } });
      expect(archivedFresh!.dateTime.getTime()).toBe(archived.event.dateTime.getTime());
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
