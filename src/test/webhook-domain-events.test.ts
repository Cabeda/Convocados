/**
 * Webhook contract tests for the timed / scheduling domain events (ADR 0050):
 * each fires exactly once per occurrence at its domain moment, with lean
 * payloads — semantic params only, no rendered copy.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("~/lib/push.server", () => ({
  sendPushToEvent: vi.fn().mockResolvedValue(undefined),
  sendPushToUser: vi.fn().mockResolvedValue(undefined),
  cleanupStalePushTokens: vi.fn().mockResolvedValue({ appTokens: 0, webSubs: 0 }),
}));

vi.mock("~/lib/email.server", () => ({
  sendReminder: vi.fn().mockResolvedValue(undefined),
  sendPaymentReminder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/auth.helpers.server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: true, session: null }),
  };
});

vi.mock("~/lib/geocode", () => ({
  resolveLocation: vi.fn().mockResolvedValue(null),
}));

const { fireWebhooks } = await import("~/lib/webhook.server");

const SECRET = "test-cron-secret";

function cronCtx() {
  return {
    request: new Request("http://localhost/api/cron/reminders", {
      method: "POST",
      headers: { authorization: `Bearer ${SECRET}` },
    }),
    params: {},
  } as any;
}

async function runCron() {
  process.env.CRON_SECRET = SECRET;
  try {
    const { POST } = await import("~/pages/api/cron/reminders");
    await POST(cronCtx());
  } finally {
    delete process.env.CRON_SECRET;
  }
}

async function seedUser(id: string, name = "Player") {
  return prisma.user.create({
    data: { id, name, email: `${id}@test.com`, emailVerified: true },
  });
}

async function seedEventWithGame(
  id: string,
  ownerId: string,
  dateTime: Date,
  extra: Record<string, unknown> = {},
) {
  const event = await prisma.event.create({
    data: {
      id,
      title: "Domain Game",
      location: "Test Field",
      dateTime,
      maxPlayers: 10,
      ownerId,
      durationMinutes: 60,
      ...(extra as object),
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

beforeEach(async () => {
  await prisma.rsvp.deleteMany().catch(() => undefined);
  await prisma.notificationJob.deleteMany().catch(() => undefined);
  await prisma.eventFollow.deleteMany().catch(() => undefined);
  await prisma.paymentNudgeStage.deleteMany().catch(() => undefined);
  await prisma.gamePayment.deleteMany().catch(() => undefined);
  await prisma.eventPlayer.deleteMany().catch(() => undefined);
  await prisma.player.deleteMany().catch(() => undefined);
  await prisma.reminderLog.deleteMany().catch(() => undefined);
  await prisma.scheduledJob.deleteMany().catch(() => undefined);
  await prisma.webhookDelivery.deleteMany().catch(() => undefined);
  await prisma.webhookSubscription.deleteMany().catch(() => undefined);
  await prisma.eventLog.deleteMany().catch(() => undefined);
  await prisma.game.deleteMany().catch(() => undefined);
  await prisma.event.deleteMany().catch(() => undefined);
  await prisma.user.deleteMany().catch(() => undefined);
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

describe("rsvp_request webhook", () => {
  it("fires once per occurrence at the T-48h fanout with lean payload", async () => {
    const owner = await seedUser("u-dr-1", "Owner");
    const player = await seedUser("u-dr-2");
    const eventDate = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const event = await seedEventWithGame("evt-dr-1", owner.id, eventDate);
    await prisma.player.create({
      data: { eventId: event.id, name: player.name, userId: player.id, order: 0 },
    });

    await runCron();

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "rsvp_request", {
      gameId: event.currentGameId,
      dateTime: eventDate.toISOString(),
    });
  });
});

describe("rsvp_summary webhook", () => {
  it("fires once per occurrence at the T-24h summary with attendance counts", async () => {
    const owner = await seedUser("u-dr-3", "Owner");
    const player1 = await seedUser("u-dr-4", "P1");
    const player2 = await seedUser("u-dr-5", "P2");
    const eventDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const event = await seedEventWithGame("evt-dr-2", owner.id, eventDate, {
      rsvpCutoffSent: true,
    });
    await prisma.player.create({
      data: { eventId: event.id, name: player1.name, userId: player1.id, order: 0 },
    });
    await prisma.player.create({
      data: { eventId: event.id, name: player2.name, userId: player2.id, order: 1 },
    });

    await runCron();

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "rsvp_summary", {
      yes: 0,
      no: 0,
      pending: 3,
    });
  });
});

describe("recruitment webhook", () => {
  // The player must hold a spot on the current Game's Roster (ADR 0016): a legacy
  // `Player` row alone is accumulated history and claims none of the 10 active spots.
  async function seedRosteredPlayer(eventId: string, gameId: string, name: string, userId: string) {
    await prisma.player.create({ data: { eventId, name, userId, order: 0 } });
    const ep = await prisma.eventPlayer.create({ data: { eventId, name, userId } });
    await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: ep.id, order: 0 } });
  }

  it("fires at the T-48h ping with spotsLeft and urgent=false", async () => {
    const owner = await seedUser("u-dr-6", "Owner");
    const player = await seedUser("u-dr-7", "P1");
    const eventDate = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const event = await seedEventWithGame("evt-dr-3", owner.id, eventDate, {
      rsvpCutoffSent: true,
    });
    await seedRosteredPlayer(event.id, event.currentGameId!, player.name, player.id);

    await runCron();

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "recruitment", {
      spotsLeft: 9,
      urgent: false,
    });
  });

  it("fires at the T-24h urgent ping with urgent=true", async () => {
    const owner = await seedUser("u-dr-8", "Owner");
    const player = await seedUser("u-dr-9", "P1");
    const eventDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const event = await seedEventWithGame("evt-dr-4", owner.id, eventDate, {
      rsvpCutoffSent: true,
    });
    await seedRosteredPlayer(event.id, event.currentGameId!, player.name, player.id);

    await runCron();

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "recruitment", {
      spotsLeft: 9,
      urgent: true,
    });
  });
});

/**
 * Seed an occurrence that ended `hoursAgo` hours ago with one debtor
 * (GamePayment row, ADR 0016 debt source).
 */
async function seedOwedGame(
  eventId: string,
  ownerId: string,
  hoursAgo: number,
  opts: { showDebtorNames?: boolean; amount?: number; debtorName?: string; debtorUserId?: string | null; payerUserId?: string } = {},
) {
  const durationMinutes = 90;
  const gameEnd = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  const dateTime = new Date(gameEnd.getTime() - durationMinutes * 60_000);
  const event = await prisma.event.create({
    data: {
      id: eventId,
      title: "Past Game",
      location: "Pitch",
      dateTime,
      durationMinutes,
      maxPlayers: 10,
      ownerId,
      showDebtorNames: opts.showDebtorNames ?? false,
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime, status: "played" } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  const debtorName = opts.debtorName ?? "Debtor";
  const ep = await prisma.eventPlayer.create({
    data: { eventId: event.id, name: debtorName, userId: opts.debtorUserId ?? null },
  });
  await prisma.gamePayment.create({
    data: {
      gameId: game.id,
      eventPlayerId: ep.id,
      playerName: debtorName,
      amount: opts.amount ?? 5,
      status: "pending",
    },
  });
  if (opts.payerUserId) {
    const payerEp = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Payer", userId: opts.payerUserId },
    });
    await prisma.game.update({ where: { id: game.id }, data: { payerEventPlayerId: payerEp.id } });
  }
  return { ...event, currentGameId: game.id };
}

describe("payment_nudge webhook", () => {
  it("fires per-debtor with lean payload when a nudge is sent", async () => {
    const owner = await seedUser("u-dr-10", "Owner");
    const debtor = await seedUser("u-dr-11", "Debtor");
    const event = await seedOwedGame("evt-dr-5", owner.id, 1, {
      showDebtorNames: true,
      debtorUserId: debtor.id,
    });

    const { processPaymentEscalation } = await import("~/lib/paymentNudgeEscalation.server");
    await processPaymentEscalation();

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "payment_nudge", {
      stage: 1,
      amountCents: 500,
      currency: "EUR",
      playerName: "Debtor",
    });
  });

  it("omits debtor name when showDebtorNames is off", async () => {
    const owner = await seedUser("u-dr-12", "Owner");
    const debtor = await seedUser("u-dr-13", "Debtor");
    await seedOwedGame("evt-dr-6", owner.id, 1, {
      showDebtorNames: false,
      debtorUserId: debtor.id,
    });

    const { processPaymentEscalation } = await import("~/lib/paymentNudgeEscalation.server");
    await processPaymentEscalation();

    expect(fireWebhooks).toHaveBeenCalledWith("evt-dr-6", "payment_nudge", {
      stage: 1,
      amountCents: 500,
      currency: "EUR",
    });
  });
});

describe("payment_organizer_alert webhook", () => {
  it("fires with unpaidCount and names when showDebtorNames is on", async () => {
    const owner = await seedUser("u-dr-14", "Owner");
    const debtor = await seedUser("u-dr-15", "Debtor");
    const event = await seedOwedGame("evt-dr-7", owner.id, 170, {
      showDebtorNames: true,
      debtorUserId: debtor.id,
    });
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: debtor.id, stage: 3 },
    });

    const { processPaymentEscalation } = await import("~/lib/paymentNudgeEscalation.server");
    await processPaymentEscalation();

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "payment_organizer_alert", {
      unpaidCount: 1,
      unpaidNames: ["Debtor"],
    });
  });

  it("omits names when showDebtorNames is off", async () => {
    const owner = await seedUser("u-dr-16", "Owner");
    const debtor = await seedUser("u-dr-17", "Debtor");
    const event = await seedOwedGame("evt-dr-8", owner.id, 170, {
      showDebtorNames: false,
      debtorUserId: debtor.id,
    });
    await prisma.paymentNudgeStage.create({
      data: { eventId: event.id, userId: debtor.id, stage: 3 },
    });

    const { processPaymentEscalation } = await import("~/lib/paymentNudgeEscalation.server");
    await processPaymentEscalation();

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "payment_organizer_alert", {
      unpaidCount: 1,
    });
  });
});

describe("payer_check_in webhook", () => {
  it("fires once when the payer is asked about outstanding payments", async () => {
    const owner = await seedUser("u-dr-21", "Owner");
    const payer = await seedUser("u-dr-22", "Payer");
    const debtor = await seedUser("u-dr-23", "Debtor");
    const event = await seedOwedGame("evt-dr-9", owner.id, 30, {
      debtorUserId: debtor.id,
      payerUserId: payer.id,
    });

    const { processPayerCheckIns } = await import("~/lib/payerCheckIn.server");
    await processPayerCheckIns();

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "payer_check_in", {
      gameId: event.currentGameId,
      dateTime: event.dateTime.toISOString(),
      amountCents: 500,
      currency: "EUR",
    });
  });
});

describe("game_rescheduled webhook", () => {
  function putCtx(eventId: string, body: unknown) {
    return {
      request: new Request("http://localhost/api/test", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      params: { id: eventId },
    } as any;
  }

  it("fires when the date/time changes", async () => {
    const event = await prisma.event.create({
      data: {
        id: "evt-dr-10",
        title: "Resched Game",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        maxPlayers: 10,
      },
    });

    const { PUT } = await import("~/pages/api/events/[id]/datetime");
    const newDate = new Date(Date.now() + 2 * 86400_000).toISOString();
    const res = await PUT(putCtx(event.id, { dateTime: newDate }));
    expect(res.status).toBe(200);

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "game_rescheduled", {});
  });

  it("does not fire when nothing changed", async () => {
    const dateTime = new Date(Date.now() + 86400_000);
    const event = await prisma.event.create({
      data: {
        id: "evt-dr-11",
        title: "Same Game",
        location: "Pitch",
        dateTime,
        maxPlayers: 10,
      },
    });

    const { PUT } = await import("~/pages/api/events/[id]/datetime");
    const res = await PUT(putCtx(event.id, { dateTime: dateTime.toISOString() }));
    expect(res.status).toBe(200);

    expect(fireWebhooks).not.toHaveBeenCalledWith(event.id, "game_rescheduled", {});
  });

  it("fires when the court/location changes", async () => {
    const event = await prisma.event.create({
      data: {
        id: "evt-dr-12",
        title: "Court Game",
        location: "Pitch A",
        dateTime: new Date(Date.now() + 86400_000),
        maxPlayers: 10,
      },
    });

    const { POST } = await import("~/pages/api/events/[id]/switch-court");
    const res = await POST(
      putCtx(event.id, { location: "Pitch B" }) as any,
    );
    expect(res.status).toBe(200);

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "game_rescheduled", {});
  });

  it("fires when the duration changes", async () => {
    const event = await prisma.event.create({
      data: {
        id: "evt-dr-13",
        title: "Dur Game",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        maxPlayers: 10,
        durationMinutes: 60,
      },
    });

    const { PUT } = await import("~/pages/api/events/[id]/duration");
    const res = await PUT(putCtx(event.id, { durationMinutes: 90 }));
    expect(res.status).toBe(200);

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "game_rescheduled", {});
  });

  it("does not fire when duration is unchanged", async () => {
    const event = await prisma.event.create({
      data: {
        id: "evt-dr-14",
        title: "Same Dur Game",
        location: "Pitch",
        dateTime: new Date(Date.now() + 86400_000),
        maxPlayers: 10,
        durationMinutes: 60,
      },
    });

    const { PUT } = await import("~/pages/api/events/[id]/duration");
    const res = await PUT(putCtx(event.id, { durationMinutes: 60 }));
    expect(res.status).toBe(200);

    expect(fireWebhooks).not.toHaveBeenCalledWith(event.id, "game_rescheduled", {});
  });
});

describe("game_scheduled webhook + creation-time webhook config", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();

  function postCtx(body: unknown) {
    return {
      request: new Request("http://localhost/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      params: {},
    } as any;
  }

  it("fires game_scheduled on creation", async () => {
    const { POST } = await import("~/pages/api/events/index");
    const res = await POST(postCtx({ title: "New Game", location: "Pitch", dateTime: future }));
    expect(res.status).toBe(200);
    const { id } = await res.json();

    expect(fireWebhooks).toHaveBeenCalledWith(id, "game_scheduled", {});
  });

  it("creates the webhook subscription atomically when webhookUrl is provided", async () => {
    const { POST } = await import("~/pages/api/events/index");
    const res = await POST(
      postCtx({
        title: "Wired Game",
        location: "Pitch",
        dateTime: future,
        webhookUrl: "https://hooks.example.com/convocados",
        webhookEvents: ["reminder", "payment_nudge"],
      }),
    );
    expect(res.status).toBe(200);
    const { id } = await res.json();

    const sub = await prisma.webhookSubscription.findFirst({ where: { eventId: id } });
    expect(sub).not.toBeNull();
    expect(sub!.url).toBe("https://hooks.example.com/convocados");
    expect(JSON.parse(sub!.events)).toEqual(["reminder", "payment_nudge"]);
    // The subscription exists before the first fact fires.
    expect(fireWebhooks).toHaveBeenCalledWith(id, "game_scheduled", {});
  });

  it("rejects unknown webhook event types at creation", async () => {
    const { POST } = await import("~/pages/api/events/index");
    const res = await POST(
      postCtx({
        title: "Bad Events",
        location: "Pitch",
        dateTime: future,
        webhookUrl: "https://hooks.example.com/convocados",
        webhookEvents: ["not_a_type"],
      }),
    );
    expect(res.status).toBe(400);
  });
});
