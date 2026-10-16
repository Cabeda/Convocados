/**
 * GH-1400 — capacity converges on the Roster module. Every scheduled /
 * notification path that answers "how many spots are left" must read it from the
 * Roster (ADR 0016: the current Game's GameParticipant rows), never from the legacy
 * `Player` rows that accumulate across an Event's Games.
 *
 * Each test seeds the SAME shape — a recurring Event past its first Game, 8 spots,
 * 10 accumulated legacy rows, 2 players on the current Game's Roster — so the one
 * number every path must report is 6. Any path deriving capacity from the legacy
 * rows answers 0 (the cron: 10), and the recruitment ping suppresses itself.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { scheduleEventReminders, processJob } from "~/lib/scheduler.server";
import { applyRosterChange } from "~/lib/applyRosterChange.server";
import { archiveAndLeave } from "~/lib/leave.server";

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
  drainNotificationQueue: vi.fn().mockResolvedValue(0),
}));

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/payments.server", () => ({
  syncPaymentsForEvent: vi.fn().mockResolvedValue(undefined),
}));

const { enqueueNotification } = await import("~/lib/notificationQueue.server");
const { sendReminder } = await import("~/lib/email.server");
const { fireWebhooks } = await import("~/lib/webhook.server");

const MAX_PLAYERS = 8;
const ROSTER_SIZE = 2;
/** The one number all five paths must report. */
const SPOTS_LEFT = MAX_PLAYERS - ROSTER_SIZE;

/** A recurring Event whose Roster has rolled on from its first Game to the next. */
async function seedEventPastFirstGame(hoursFromNow: number, extra: Record<string, unknown> = {}) {
  const dateTime = new Date(Date.now() + hoursFromNow * 3600_000);
  const event = await prisma.event.create({
    data: {
      title: "Ninjas da Areosa",
      location: "Pitch",
      dateTime,
      maxPlayers: MAX_PLAYERS,
      isRecurring: true,
      recurrenceRule: "FREQ=WEEKLY",
      ...extra,
    },
  });
  // The first Game is already played; the Event has rolled on to the second.
  await prisma.game.create({ data: { eventId: event.id, dateTime: new Date(Date.now() - 7 * 86400_000) } });
  const currentGame = await prisma.game.create({ data: { eventId: event.id, dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: currentGame.id } });

  // Legacy Player rows accumulate across the Event's past Games (ADR 0016):
  // 10 rows for an Event whose current Game has only two players on it.
  await prisma.player.createMany({
    data: Array.from({ length: 10 }, (_, i) => ({ eventId: event.id, name: `Churn ${i}`, order: i })),
  });
  for (let i = 0; i < ROSTER_SIZE; i++) {
    const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: `Player ${i + 1}` } });
    await prisma.gameParticipant.create({ data: { gameId: currentGame.id, eventPlayerId: ep.id, order: i } });
  }
  return { ...event, currentGameId: currentGame.id };
}

/** A user who wants reminder email, so the email template's capacity is exercised. */
async function seedEmailOptedInUser(id: string, name: string, eventId: string) {
  const user = await prisma.user.create({ data: { id, name, email: `${id}@test.com`, emailVerified: true } });
  await prisma.notificationPreferences.create({
    data: { userId: user.id, emailEnabled: true, gameReminderEmail: true, reminder24h: true },
  });
  await prisma.player.create({ data: { eventId, name, userId: user.id, order: 0 } });
  return user;
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetRateLimitStore();
  resetApiRateLimitStore();
  await prisma.notificationPreferences.deleteMany();
  await prisma.playerInvite.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.scheduledJob.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("scheduler — reminder job", () => {
  it("reports the current Game's Roster capacity, not the accumulated legacy rows", async () => {
    const event = await seedEventPastFirstGame(25);
    await seedEmailOptedInUser("u-sched-1", "Player 1", event.id);
    await scheduleEventReminders(event.id, event.dateTime, 60);

    const job = await prisma.scheduledJob.findFirstOrThrow({
      where: { eventId: event.id, type: "reminder_24h" },
    });
    await processJob(job.id);

    expect(enqueueNotification).toHaveBeenCalledWith(
      event.id,
      "reminder",
      expect.objectContaining({ spotsLeft: SPOTS_LEFT }),
    );
    expect(sendReminder).toHaveBeenCalledWith("u-sched-1@test.com", expect.objectContaining({ spotsLeft: SPOTS_LEFT }));
  });

  it("reports the current Game's Roster capacity on the post-game job", async () => {
    const event = await seedEventPastFirstGame(25);
    await scheduleEventReminders(event.id, event.dateTime, 60);

    const job = await prisma.scheduledJob.findFirstOrThrow({
      where: { eventId: event.id, type: "post_game" },
    });
    await processJob(job.id);

    expect(enqueueNotification).toHaveBeenCalledWith(
      event.id,
      "post_game",
      expect.objectContaining({ spotsLeft: SPOTS_LEFT }),
    );
  });
});

describe("reminders cron", () => {
  const SECRET = "test-cron-secret";

  async function runCron() {
    process.env.CRON_SECRET = SECRET;
    try {
      const { POST } = await import("~/pages/api/cron/reminders");
      await POST({
        request: new Request("http://localhost/api/cron/reminders", {
          method: "POST",
          headers: { authorization: `Bearer ${SECRET}` },
        }),
        params: {},
      } as any);
    } finally {
      delete process.env.CRON_SECRET;
    }
  }

  it("reports the current Game's Roster capacity on the push and the email", async () => {
    const event = await seedEventPastFirstGame(24);
    await seedEmailOptedInUser("u-cron-1", "Player 1", event.id);

    await runCron();

    expect(enqueueNotification).toHaveBeenCalledWith(
      event.id,
      "reminder",
      expect.objectContaining({ spotsLeft: SPOTS_LEFT }),
    );
    expect(sendReminder).toHaveBeenCalledWith("u-cron-1@test.com", expect.objectContaining({ spotsLeft: SPOTS_LEFT }));
  });

  it("reports the current Game's Roster capacity on the recruitment ping", async () => {
    const event = await seedEventPastFirstGame(48, { rsvpCutoffSent: true });

    await runCron();

    expect(fireWebhooks).toHaveBeenCalledWith(event.id, "recruitment", {
      spotsLeft: SPOTS_LEFT,
      urgent: false,
    });
  });
});

describe("invitation path — invite link lookup", () => {
  it("reports the current Game's Roster capacity and the Roster as guests", async () => {
    const event = await seedEventPastFirstGame(24);
    const owner = await prisma.user.create({
      data: { id: "u-inv-owner", name: "Owner", email: "owner@test.com", emailVerified: true },
    });
    const invitee = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Invitee" } });
    await prisma.playerInvite.create({
      data: { gameId: event.currentGameId, eventPlayerId: invitee.id, invitedByUserId: owner.id, token: "tok-1400" },
    });

    const { GET } = await import("~/pages/api/invite/[token]");
    const res = await GET({ params: { token: "tok-1400" }, request: new Request("http://localhost/api/invite/tok-1400") } as any);
    const body = await res.json();

    expect(body.spotsLeft).toBe(SPOTS_LEFT);
    // The invite ghost is not on the Roster yet, so it must not appear as a guest.
    expect(body.guests).toEqual(["Player 1", "Player 2"]);
  });
});

describe("roster-change path — a player joins", () => {
  it("reports the capacity left AFTER the join, from the current Game's Roster", async () => {
    const event = await seedEventPastFirstGame(24);
    const loaded = await prisma.event.findUniqueOrThrow({
      where: { id: event.id },
      include: { players: { where: { archivedAt: null }, orderBy: { order: "asc" } } },
    });

    const result = await applyRosterChange({
      eventId: event.id,
      origin: "http://localhost",
      session: null,
      senderClientId: undefined,
      body: { name: "Fresh Guy" },
      event: loaded,
    });

    expect(result.status).toBe(200);
    expect(fireWebhooks).toHaveBeenCalledWith(
      event.id,
      "player_joined",
      expect.objectContaining({ spotsLeft: SPOTS_LEFT - 1, isActive: true }),
    );
    // A 3/8 Game is not full — the accumulated legacy rows must not fire game_full.
    expect(fireWebhooks).not.toHaveBeenCalledWith(event.id, "game_full", expect.anything());
  });
});

describe("leave path — a player leaves", () => {
  it("reports the capacity left AFTER the leave, from the current Game's Roster", async () => {
    const event = await seedEventPastFirstGame(24);
    const leaver = await prisma.player.create({
      data: { eventId: event.id, name: "Player 1", order: 0 },
    });

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "organizer", userId: null },
      playerId: leaver.id,
    });

    expect(fireWebhooks).toHaveBeenCalledWith(
      event.id,
      "player_left",
      expect.objectContaining({ playerName: "Player 1", spotsLeft: SPOTS_LEFT + 1 }),
    );
  });
});