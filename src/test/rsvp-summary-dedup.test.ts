/**
 * Regression: T-24h organizer RSVP summary ("X confirmed, Y declined, Z pending")
 * must fire ONCE per occurrence, not on every cron tick inside the T-24h ±1h window.
 *
 * Bug (prod): for a game at 19:00 the owner got the attendance-check push every
 * 5 minutes from 18:00 to 20:00 (24+ spam notifications) because
 * getEventsNeedingRsvpSummary() had no dedup flag — unlike the 48h ping
 * (rsvpCutoffSent) and the recruitment pings (recruitment48hSent / 24hSent).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

const mockSendPushToUser = vi.fn().mockResolvedValue(undefined);

vi.mock("~/lib/push.server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sendPushToUser: (...args: unknown[]) => mockSendPushToUser(...args),
    cleanupStalePushTokens: vi.fn().mockResolvedValue({ appTokens: 0, webSubs: 0 }),
  };
});

vi.mock("~/lib/email.server", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    sendReminder: vi.fn().mockResolvedValue(undefined),
    sendPaymentReminder: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST } from "~/pages/api/cron/reminders";

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

function summaryPushes() {
  return mockSendPushToUser.mock.calls.filter((c) => String(c[1]).includes("attendance check"));
}

beforeEach(async () => {
  process.env.CRON_SECRET = SECRET;
  mockSendPushToUser.mockClear();
  await prisma.rsvp.deleteMany();
  await prisma.notificationJob.deleteMany().catch(() => undefined);
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.reminderLog.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  // Game at now+24h: inside the T-24h ±1h window that the 5-minute cron
  // sweeps repeatedly between 18:00 and 20:00 for a 19:00 game.
  const owner = await prisma.user.create({
    data: { id: "owner1", name: "Owner", email: "owner@test.com", emailVerified: true },
  });
  const player = await prisma.user.create({
    data: { id: "player1", name: "Player", email: "player@test.com", emailVerified: true },
  });
  const event = await prisma.event.create({
    data: {
      id: "e-spam",
      title: "Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + 24 * 3600_000),
      ownerId: owner.id,
      rsvpCutoffSent: true,
      maxPlayers: 10,
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  await prisma.player.create({
    data: { eventId: event.id, name: player.name, userId: player.id, order: 0 },
  });
});

afterEach(() => {
  delete process.env.CRON_SECRET;
});

describe("T-24h organizer RSVP summary dedup", () => {
  it("sends the summary exactly once across consecutive cron ticks", async () => {
    const first = await POST(cronCtx());
    expect(first.status).toBe(200);
    const body1 = await first.json();
    expect(body1.rsvpSummariesSent).toHaveLength(1);
    expect(summaryPushes()).toHaveLength(1);

    // Second tick 5 minutes later, same window — must NOT re-send.
    const second = await POST(cronCtx());
    expect(second.status).toBe(200);
    const body2 = await second.json();
    expect(body2.rsvpSummariesSent).toHaveLength(0);
    expect(summaryPushes()).toHaveLength(1);

    // Third tick — still silent.
    await POST(cronCtx());
    expect(summaryPushes()).toHaveLength(1);
  });
});
