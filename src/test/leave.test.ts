import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { archiveAndLeave, isWithin48hBeforeKickoff } from "~/lib/leave.server";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/payments.server", () => ({
  syncPaymentsForEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("~/lib/eventLog.server", () => ({
  logEvent: vi.fn().mockResolvedValue(undefined),
}));

const { enqueueNotification } = await import("~/lib/notificationQueue.server");

beforeEach(async () => {
  vi.clearAllMocks();
  await prisma.rsvp.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

async function seedUser(name = "Alice", id?: string) {
  return prisma.user.create({
    data: {
      id: id ?? `u-${Math.random().toString(36).slice(2, 8)}`,
      name,
      email: `${id ?? Math.random().toString(36).slice(2, 8)}@t.com`,
      emailVerified: true,
    },
  });
}

async function seedEvent(ownerId: string | null, dateOffsetMs = 7 * 86400_000) {
  return prisma.event.create({
    data: {
      title: "Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + dateOffsetMs),
      ownerId,
      maxPlayers: 5,
    },
  });
}

describe("isWithin48hBeforeKickoff", () => {
  it("returns true when kickoff is 12h away", () => {
    const dateTime = new Date(Date.now() + 12 * 3600_000);
    expect(isWithin48hBeforeKickoff(dateTime)).toBe(true);
  });

  it("returns true at exactly 48h boundary", () => {
    const dateTime = new Date(Date.now() + 48 * 3600_000);
    expect(isWithin48hBeforeKickoff(dateTime)).toBe(true);
  });

  it("returns false when kickoff is 49h away", () => {
    const dateTime = new Date(Date.now() + 49 * 3600_000);
    expect(isWithin48hBeforeKickoff(dateTime)).toBe(false);
  });

  it("returns false for past events", () => {
    const dateTime = new Date(Date.now() - 3600_000);
    expect(isWithin48hBeforeKickoff(dateTime)).toBe(false);
  });
});

describe("archiveAndLeave — self-leave", () => {
  it("soft-archives the player's row and sets Rsvp.status = 'no'", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null);
    const player = await prisma.player.create({
      data: { eventId: event.id, name: "Alice", userId: user.id, order: 0 },
    });

    const result = await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: player.id,
    });

    expect(result.ok).toBe(true);
    const updated = await prisma.player.findUnique({ where: { id: player.id } });
    expect(updated?.archivedAt).not.toBeNull();
    const rsvp = await prisma.rsvp.findUnique({
      where: { userId_eventId: { userId: user.id, eventId: event.id } },
    });
    expect(rsvp?.status).toBe("no");
  });

  it("auto-unfollows on self-removal", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null);
    const player = await prisma.player.create({
      data: { eventId: event.id, name: "Alice", userId: user.id, order: 0 },
    });
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: user.id } });

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: player.id,
    });

    const follow = await prisma.eventFollow.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: user.id } },
    });
    expect(follow).toBeNull();
  });

  it("does not auto-unfollow on organizer removal of a linked user", async () => {
    const owner = await seedUser("Owner", "u-owner");
    const linked = await seedUser("Linked", "u-linked");
    const event = await seedEvent(owner.id);
    const player = await prisma.player.create({
      data: { eventId: event.id, name: "Linked", userId: linked.id, order: 0 },
    });
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: linked.id } });

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "organizer", userId: owner.id },
      playerId: player.id,
    });

    const follow = await prisma.eventFollow.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: linked.id } },
    });
    expect(follow).not.toBeNull();
  });
});

describe("archiveAndLeave — admin decline guest (organizer path)", () => {
  it("soft-archives the guest player AND writes Rsvp.status='no' with respondedByUserId audit", async () => {
    const owner = await seedUser("Owner", "u-owner");
    const event = await seedEvent(owner.id);
    const guest = await prisma.player.create({
      data: { eventId: event.id, name: "Guest", order: 0 },
    });

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "organizer", userId: owner.id },
      playerId: guest.id,
    });

    const updated = await prisma.player.findUnique({ where: { id: guest.id } });
    expect(updated?.archivedAt).not.toBeNull();
    // The organizer + guest branch writes Rsvp.status="no" with the respondedByUserId audit field,
    // so the summary chips reflect the decline even though the guest can't self-RSVP.
    const rsvp = await prisma.rsvp.findUnique({
      where: { playerId_eventId: { playerId: guest.id, eventId: event.id } },
    });
    expect(rsvp?.status).toBe("no");
    expect(rsvp?.respondedByUserId).toBe(owner.id);
  });
});

describe("archiveAndLeave — bench state after removal", () => {
  it("computes benchEmpty=true when no bench players and wasActive", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null); // maxPlayers: 5
    // active: 5 (Alice + 4 others), bench: 0
    const alice = await prisma.player.create({
      data: { eventId: event.id, name: "Alice", userId: user.id, order: 0 },
    });
    for (let i = 1; i < 5; i++) {
      await prisma.player.create({ data: { eventId: event.id, name: `P${i}`, order: i } });
    }

    const result = await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: alice.id,
    });
    expect(result.benchEmptyAfter).toBe(true);
  });

  it("computes benchEmpty=false when bench has players", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null); // maxPlayers: 5
    // active: 5, bench: 1
    const alice = await prisma.player.create({
      data: { eventId: event.id, name: "Alice", userId: user.id, order: 0 },
    });
    for (let i = 1; i < 5; i++) {
      await prisma.player.create({ data: { eventId: event.id, name: `P${i}`, order: i } });
    }
    await prisma.player.create({ data: { eventId: event.id, name: "Bench1", order: 5 } });

    const result = await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: alice.id,
    });
    expect(result.benchEmptyAfter).toBe(false);
  });

  it("benchEmptyAfter is false for bench players (no warn-the-rest)", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null); // maxPlayers: 5
    for (let i = 0; i < 5; i++) {
      await prisma.player.create({ data: { eventId: event.id, name: `A${i}`, order: i } });
    }
    const alice = await prisma.player.create({
      data: { eventId: event.id, name: "Alice", userId: user.id, order: 5 }, // bench
    });

    const result = await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: alice.id,
    });
    expect(result.benchEmptyAfter).toBe(false);
  });
});

describe("archiveAndLeave — push notification gating", () => {
  it("fires player_left when within 48h AND bench is empty after active removal", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null, 12 * 3600_000); // 12h away — within 48h
    const alice = await prisma.player.create({
      data: { eventId: event.id, name: "Alice", userId: user.id, order: 0 },
    });
    for (let i = 1; i < 5; i++) {
      await prisma.player.create({ data: { eventId: event.id, name: `P${i}`, order: i } });
    }

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: alice.id,
    });

    expect(enqueueNotification).toHaveBeenCalledWith(
      event.id,
      "player_left",
      expect.objectContaining({ key: "notifyPlayerLeft", params: expect.objectContaining({ name: "Alice" }) }),
      expect.anything(),
    );
  });

  it("does NOT fire player_left when within 48h BUT bench has a player (auto-promoted)", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null, 12 * 3600_000);
    const alice = await prisma.player.create({
      data: { eventId: event.id, name: "Alice", userId: user.id, order: 0 },
    });
    for (let i = 1; i < 5; i++) {
      await prisma.player.create({ data: { eventId: event.id, name: `P${i}`, order: i } });
    }
    await prisma.player.create({ data: { eventId: event.id, name: "Bench1", order: 5 } });

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: alice.id,
    });

    expect(enqueueNotification).not.toHaveBeenCalledWith(
      expect.anything(),
      "player_left",
      expect.anything(),
      expect.anything(),
    );
  });

  it("fires spot_available when outside 48h (ADR 0017 removed the 48h gate)", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null, 7 * 86400_000); // 7 days — outside 48h
    const alice = await prisma.player.create({
      data: { eventId: event.id, name: "Alice", userId: user.id, order: 0 },
    });
    for (let i = 1; i < 5; i++) {
      await prisma.player.create({ data: { eventId: event.id, name: `P${i}`, order: i } });
    }

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: alice.id,
    });

    expect(enqueueNotification).toHaveBeenCalledWith(
      event.id,
      "spot_available",
      expect.objectContaining({ key: "notifySpotAvailable" }),
      "u-alice",
    );
  });

  it("does NOT fire player_left for bench player removal (even within 48h + empty bench)", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null, 12 * 3600_000);
    for (let i = 0; i < 5; i++) {
      await prisma.player.create({ data: { eventId: event.id, name: `A${i}`, order: i } });
    }
    const alice = await prisma.player.create({
      data: { eventId: event.id, name: "Alice", userId: user.id, order: 5 }, // bench
    });

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: alice.id,
    });

    // Bench player removal fires player_left_bench (existing behavior) but NOT player_left (the warn-the-rest push).
    expect(enqueueNotification).not.toHaveBeenCalledWith(
      expect.anything(),
      "player_left",
      expect.anything(),
      expect.anything(),
    );
  });
});

describe("archiveAndLeave — input validation", () => {
  it("throws when player does not exist", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null);
    await expect(archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: "does-not-exist",
    })).rejects.toThrow(/player not found/i);
  });

  it("throws when player does not belong to the event", async () => {
    const user = await seedUser("Alice", "u-alice");
    const ev1 = await seedEvent(null);
    const ev2 = await seedEvent(null);
    const player = await prisma.player.create({
      data: { eventId: ev1.id, name: "X", userId: user.id, order: 0 },
    });
    await expect(archiveAndLeave({
      eventId: ev2.id,
      actor: { kind: "self", userId: user.id },
      playerId: player.id,
    })).rejects.toThrow(/player not found/i);
  });

  it("refuses self-leave when the user is not the player", async () => {
    const owner = await seedUser("Owner", "u-owner");
    const stranger = await seedUser("Stranger", "u-stranger");
    const event = await seedEvent(owner.id);
    const player = await prisma.player.create({
      data: { eventId: event.id, name: "X", order: 0 },
    });
    await expect(archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: stranger.id },
      playerId: player.id,
    })).rejects.toThrow(/your own behalf/i);
  });
});
