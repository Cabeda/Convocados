import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/scheduler.server", () => ({
  cancelEventJobs: vi.fn().mockResolvedValue(undefined),
  scheduleEventReminders: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/priority.server", () => ({
  autoPriorityEnroll: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/autoConfirm.server", () => ({
  applyAutoConfirm: vi.fn().mockResolvedValue(undefined),
}));

const mockGetSession = vi.fn().mockResolvedValue(null);
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: vi.fn(),
  checkEventAdmin: vi.fn(),
}));

import { checkOwnership, checkEventAdmin } from "~/lib/auth.helpers.server";
const mockCheckOwnership = vi.mocked(checkOwnership);
const mockCheckEventAdmin = vi.mocked(checkEventAdmin);

import { enqueueNotification } from "~/lib/notificationQueue.server";
const mockEnqueueNotification = vi.mocked(enqueueNotification);

import { PUT as cancelGame } from "~/pages/api/events/[id]/cancel";

function putCtx(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers: { "content-type": "application/json" },
  });
  return { request, params } as any;
}

async function seedUser() {
  await prisma.user.upsert({
    where: { id: "user1" },
    create: { id: "user1", name: "Owner", email: "owner@test.com", emailVerified: true },
    update: {},
  });
}

async function seedEvent(overrides: Partial<{
  ownerId: string | null;
  isRecurring: boolean;
  recurrenceRule: string | null;
  dateTime: Date;
}> = {}) {
  const data: any = {
    title: "Test Game",
    location: "Pitch A",
    dateTime: overrides.dateTime ?? new Date(Date.now() + 86400_000),
    durationMinutes: 60,
    ownerId: overrides.ownerId ?? "user1",
    isRecurring: overrides.isRecurring ?? false,
    recurrenceRule: overrides.recurrenceRule ?? null,
  };
  return prisma.event.create({ data });
}

async function seedGame(eventId: string, status = "upcoming") {
  const event = await prisma.event.findUniqueOrThrow({ where: { id: eventId } });
  const game = await prisma.game.create({
    data: { eventId, dateTime: event.dateTime, status },
  });
  await prisma.event.update({
    where: { id: eventId },
    data: { currentGameId: game.id },
  });
  return game;
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  mockCheckOwnership.mockReset();
  mockCheckEventAdmin.mockReset();
  mockEnqueueNotification.mockReset();
  await resetApiRateLimitStore();
  await prisma.eventLog.deleteMany();
  await prisma.gamePayment.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.gameHistory.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

describe("PUT /api/events/[id]/cancel", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await cancelGame(putCtx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when not owner or admin", async () => {
    await seedUser();
    const event = await seedEvent({ ownerId: "user1" });

    mockGetSession.mockResolvedValue({ user: { id: "other" } });
    mockCheckEventAdmin.mockResolvedValue(false);

    const res = await cancelGame(putCtx({ id: event.id }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/admin|owner/i);
  });

  it("allows owner to cancel a non-recurring game", async () => {
    await seedUser();
    const event = await seedEvent({ ownerId: "user1" });
    await seedGame(event.id);

    mockGetSession.mockResolvedValue({ user: { id: "user1", name: "Owner" } });
    mockCheckEventAdmin.mockResolvedValue(false);

    const res = await cancelGame(putCtx({ id: event.id }));
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.ok).toBe(true);

    const game = await prisma.game.findFirst({ where: { eventId: event.id } });
    expect(game?.status).toBe("cancelled");

    const history = await prisma.gameHistory.findFirst({ where: { eventId: event.id } });
    expect(history).not.toBeNull();
    expect(history!.status).toBe("cancelled");

    const eventAfter = await prisma.event.findUnique({ where: { id: event.id } });
    expect(eventAfter?.currentGameId).toBe(game!.id);
  });

  it("allows admin to cancel a game", async () => {
    await seedUser();
    const event = await seedEvent({ ownerId: "user1" });
    await seedGame(event.id);

    mockGetSession.mockResolvedValue({ user: { id: "admin1", name: "Admin" } });
    mockCheckEventAdmin.mockResolvedValue(true);

    const res = await cancelGame(putCtx({ id: event.id }));
    expect(res.status).toBe(200);
  });

  it("cancels current game and advances to next occurrence for recurring events", async () => {
    await seedUser();
    const future = new Date(Date.now() + 86400_000);
    const event = await seedEvent({
      ownerId: "user1",
      isRecurring: true,
      recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }),
      dateTime: future,
    });
    await seedGame(event.id);

    mockGetSession.mockResolvedValue({ user: { id: "user1", name: "Owner" } });
    mockCheckEventAdmin.mockResolvedValue(false);

    const res = await cancelGame(putCtx({ id: event.id }));
    expect(res.status).toBe(200);

    const game = await prisma.game.findFirst({
      where: { eventId: event.id, dateTime: future },
    });
    expect(game?.status).toBe("cancelled");

    const newGame = await prisma.game.findFirst({
      where: { eventId: event.id, status: "upcoming" },
    });
    expect(newGame).not.toBeNull();
    expect(newGame!.dateTime.getTime()).toBeGreaterThan(future.getTime());

    const eventAfter = await prisma.event.findUnique({ where: { id: event.id } });
    expect(eventAfter?.currentGameId).toBe(newGame!.id);

    const cancelledHistory = await prisma.gameHistory.findFirst({
      where: { eventId: event.id, status: "cancelled" },
    });
    expect(cancelledHistory).not.toBeNull();
  });

  it("returns error when game is already past", async () => {
    await seedUser();
    const past = new Date(Date.now() - 3600_000);
    const event = await seedEvent({ ownerId: "user1", dateTime: past });
    await seedGame(event.id);

    mockGetSession.mockResolvedValue({ user: { id: "user1", name: "Owner" } });
    mockCheckEventAdmin.mockResolvedValue(false);

    const res = await cancelGame(putCtx({ id: event.id }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("returns error when game is already cancelled", async () => {
    await seedUser();
    const event = await seedEvent({ ownerId: "user1" });
    await seedGame(event.id, "cancelled");

    mockGetSession.mockResolvedValue({ user: { id: "user1", name: "Owner" } });
    mockCheckEventAdmin.mockResolvedValue(false);

    const res = await cancelGame(putCtx({ id: event.id }));
    expect(res.status).toBe(400);
  });

  it("returns error when event has no current game", async () => {
    await seedUser();
    const event = await seedEvent({ ownerId: "user1" });

    mockGetSession.mockResolvedValue({ user: { id: "user1", name: "Owner" } });
    mockCheckEventAdmin.mockResolvedValue(false);

    const res = await cancelGame(putCtx({ id: event.id }));
    expect(res.status).toBe(400);
  });

  it("logs the cancellation event", async () => {
    await seedUser();
    const event = await seedEvent({ ownerId: "user1" });
    await seedGame(event.id);

    mockGetSession.mockResolvedValue({ user: { id: "user1", name: "Owner" } });
    mockCheckEventAdmin.mockResolvedValue(false);

    await cancelGame(putCtx({ id: event.id }));

    const logs = await prisma.eventLog.findMany({ where: { eventId: event.id } });
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("game_cancelled");
  });

  it("does NOT send a game_cancelled notification for a non-recurring event", async () => {
    await seedUser();
    const event = await seedEvent({ ownerId: "user1" });
    await seedGame(event.id);

    mockGetSession.mockResolvedValue({ user: { id: "user1", name: "Owner" } });
    mockCheckEventAdmin.mockResolvedValue(false);

    await cancelGame(putCtx({ id: event.id }));

    expect(mockEnqueueNotification).not.toHaveBeenCalled();
  });

  it("does NOT send a game_cancelled notification for a recurring event", async () => {
    await seedUser();
    const future = new Date(Date.now() + 86400_000);
    const event = await seedEvent({
      ownerId: "user1",
      isRecurring: true,
      recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }),
      dateTime: future,
    });
    await seedGame(event.id);

    mockGetSession.mockResolvedValue({ user: { id: "user1", name: "Owner" } });
    mockCheckEventAdmin.mockResolvedValue(false);

    await cancelGame(putCtx({ id: event.id }));

    expect(mockEnqueueNotification).not.toHaveBeenCalled();
  });

  it("resets recruitment dedup flags for the next occurrence on recurring cancel", async () => {
    await seedUser();
    const future = new Date(Date.now() + 86400_000);
    const event = await seedEvent({
      ownerId: "user1",
      isRecurring: true,
      recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }),
      dateTime: future,
    });
    await seedGame(event.id);

    await prisma.event.update({
      where: { id: event.id },
      data: { recruitment48hSent: true, recruitment24hSent: true, rsvpCutoffSent: true },
    });

    mockGetSession.mockResolvedValue({ user: { id: "user1", name: "Owner" } });
    mockCheckEventAdmin.mockResolvedValue(false);

    await cancelGame(putCtx({ id: event.id }));

    const eventAfter = await prisma.event.findUnique({ where: { id: event.id } });
    expect(eventAfter?.rsvpCutoffSent).toBe(false);
    expect(eventAfter?.recruitment48hSent).toBe(false);
    expect(eventAfter?.recruitment24hSent).toBe(false);
  });
});
