/**
 * GH-1750 — the recruitment ping goes to non-playing followers, not the roster.
 *
 * Joining creates a follow, so "followers plus the owner" includes every player
 * already in the game. The cron computed the non-playing followers and threw the
 * list away; the queue then sent "still needs players, join now" to the people
 * who cannot act on it.
 *
 * The audience is observed where the drain hands it to the push transport, not
 * at the enqueue call, so this fails for the recipient reason and not because a
 * payload key is missing.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { resolveJobAudience } from "~/lib/eventAudience.server";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const sendPushToEvent = vi.fn().mockResolvedValue(undefined);
const sendPushToUser = vi.fn().mockResolvedValue(undefined);
vi.mock("~/lib/push.server", () => ({
  sendPushToEvent: (...args: unknown[]) => sendPushToEvent(...args),
  sendPushToUser: (...args: unknown[]) => sendPushToUser(...args),
  cleanupStalePushTokens: vi.fn().mockResolvedValue({ appTokens: 0, webSubs: 0 }),
}));

vi.mock("~/lib/email.server", () => ({
  sendReminder: vi.fn().mockResolvedValue(undefined),
  sendPaymentReminder: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

const HOUR = 3600_000;

async function seedUser(id: string) {
  await prisma.user.create({
    data: { id, name: id, email: `${id}@test.com`, emailVerified: true },
  });
  return id;
}

async function follow(eventId: string, userId: string) {
  await prisma.eventFollow.create({ data: { eventId, userId } });
}

/** Put [userId] on the Event's current Game, at roster [order]. */
async function joinRoster(eventId: string, gameId: string, userId: string, order: number) {
  const player = await prisma.eventPlayer.create({
    data: { eventId, name: userId, userId },
  });
  await prisma.gameParticipant.create({
    data: { gameId, eventPlayerId: player.id, order },
  });
}

async function seedEvent(hoursFromNow: number, maxPlayers = 3) {
  const dateTime = new Date(Date.now() + hoursFromNow * HOUR);
  const event = await prisma.event.create({
    data: {
      title: "Recruitment Game",
      location: "Pitch",
      dateTime,
      maxPlayers,
      rsvpCutoffSent: true,
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { event, game };
}

async function runCron() {
  process.env.CRON_SECRET = "test-cron-secret";
  try {
    const { POST } = await import("~/pages/api/cron/reminders");
    await POST({
      request: new Request("http://localhost/api/cron/reminders", {
        method: "POST",
        headers: { authorization: "Bearer test-cron-secret" },
      }),
      params: {},
    } as never);
  } finally {
    delete process.env.CRON_SECRET;
  }
}

/** The audience handed to the push transport for [key], if it was sent. */
function audienceFor(key: string): { userIds: string[] } | undefined {
  const call = sendPushToEvent.mock.calls.find((args) => args[2] === key);
  return call?.[9] as { userIds: string[] } | undefined;
}

function recipientIdsFor(key: string): string[] {
  return audienceFor(key)?.userIds ?? [];
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetRateLimitStore();
  resetApiRateLimitStore();
  await prisma.notificationJob.deleteMany();
  await prisma.inAppNotification.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.rsvp.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.scheduledJob.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("GH-1750 — recruitment recipients are off-roster", () => {
  it("T-48h excludes the active roster and includes an off-roster follower", async () => {
    const owner = await seedUser("owner");
    const active1 = await seedUser("active-1");
    const active2 = await seedUser("active-2");
    const offRoster = await seedUser("off-roster");

    const { event, game } = await seedEvent(48);
    await prisma.event.update({ where: { id: event.id }, data: { ownerId: owner } });
    await joinRoster(event.id, game.id, active1, 0);
    await joinRoster(event.id, game.id, active2, 1);
    await follow(event.id, active1);
    await follow(event.id, active2);
    await follow(event.id, offRoster);

    await runCron();

    const recipients = recipientIdsFor("notifyRecruitment");
    expect(recipients).toContain(offRoster);
    expect(recipients).not.toContain(active1);
    expect(recipients).not.toContain(active2);
  });

  it("T-24h excludes the active roster and leaves the owner to the share prompt", async () => {
    const owner = await seedUser("owner");
    const active1 = await seedUser("active-1");
    const active2 = await seedUser("active-2");
    const offRoster = await seedUser("off-roster");

    const { event, game } = await seedEvent(24);
    await prisma.event.update({ where: { id: event.id }, data: { ownerId: owner } });
    await joinRoster(event.id, game.id, active1, 0);
    await joinRoster(event.id, game.id, active2, 1);
    await follow(event.id, active1);
    await follow(event.id, active2);
    await follow(event.id, offRoster);
    await follow(event.id, owner);

    await runCron();

    const recipients = recipientIdsFor("notifyRecruitmentUrgent");
    expect(recipients).toContain(offRoster);
    expect(recipients).not.toContain(active1);
    expect(recipients).not.toContain(active2);
    expect(recipients).not.toContain(owner);

    const sharePrompts = sendPushToUser.mock.calls.filter(
      (args) => typeof args[3] === "string" && args[3].includes("action=share"),
    );
    expect(sharePrompts).toHaveLength(1);
  });

  it("resolveJobAudience drops every current-Game member when the job is nonPlayingOnly", async () => {
    const owner = await seedUser("owner");
    const active1 = await seedUser("active-1");
    const bench1 = await seedUser("bench-1");
    const offRoster = await seedUser("off-roster");

    const { event, game } = await seedEvent(24, 1);
    await prisma.event.update({ where: { id: event.id }, data: { ownerId: owner } });
    await joinRoster(event.id, game.id, active1, 0);
    await joinRoster(event.id, game.id, bench1, 1);
    await follow(event.id, active1);
    await follow(event.id, bench1);
    await follow(event.id, offRoster);

    const audience = await resolveJobAudience(event.id, "recruitment", {
      nonPlayingOnly: true,
      includeOwner: false,
    });

    expect(audience.userIds).toEqual([offRoster]);
  });
});
