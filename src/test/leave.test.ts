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
const { fireWebhooks } = await import("~/lib/webhook.server");

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
  const event = await prisma.event.create({
    data: {
      title: "Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + dateOffsetMs),
      ownerId,
      maxPlayers: 5,
    },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

async function seedRoster(
  eventId: string,
  gameId: string,
  names: Array<{ name: string; userId?: string }>,
) {
  const rows: { player: { id: string }; ep: { id: string } }[] = [];
  for (let i = 0; i < names.length; i++) {
    const { name, userId } = names[i];
    const player = await prisma.player.create({
      data: { eventId, name, userId: userId ?? null, order: i },
    });
    const ep = await prisma.eventPlayer.create({
      data: { eventId, name, userId: userId ?? null },
    });
    await prisma.gameParticipant.create({ data: { gameId, eventPlayerId: ep.id, order: i } });
    rows.push({ player: { id: player.id }, ep: { id: ep.id } });
  }
  return rows;
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
    await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Alice", userId: user.id },
    });

    const result = await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: player.id,
    });

    expect(result.ok).toBe(true);
    const updated = await prisma.player.findUnique({ where: { id: player.id } });
    expect(updated?.archivedAt).not.toBeNull();
    const rsvp = await prisma.rsvp.findFirst({
      where: { gameId: event.currentGameId! },
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
    await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "Guest" },
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
    const rsvp = await prisma.rsvp.findFirst({
      where: { gameId: event.currentGameId! },
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
    const rows = await seedRoster(event.id, event.currentGameId!, [
      { name: "Alice", userId: user.id },
      { name: "P1" }, { name: "P2" }, { name: "P3" }, { name: "P4" },
    ]);

    const result = await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: rows[0].player.id,
    });
    expect(result.benchEmptyAfter).toBe(true);
  });

  it("computes benchEmpty=false when bench has players", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null); // maxPlayers: 5
    // active: 5, bench: 1
    const rows = await seedRoster(event.id, event.currentGameId!, [
      { name: "Alice", userId: user.id },
      { name: "P1" }, { name: "P2" }, { name: "P3" }, { name: "P4" },
      { name: "Bench1" },
    ]);

    const result = await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: rows[0].player.id,
    });
    expect(result.benchEmptyAfter).toBe(false);
  });

  it("benchEmptyAfter is false for bench players (no warn-the-rest)", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null); // maxPlayers: 5
    const rows = await seedRoster(event.id, event.currentGameId!, [
      { name: "A0" }, { name: "A1" }, { name: "A2" }, { name: "A3" }, { name: "A4" },
      { name: "Alice", userId: user.id }, // bench
    ]);

    const result = await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: rows[5].player.id,
    });
    expect(result.benchEmptyAfter).toBe(false);
  });
});

describe("archiveAndLeave — push notification gating", () => {
  it("fires player_left when within 48h AND bench is empty after active removal", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await seedEvent(null, 12 * 3600_000); // 12h away — within 48h
    const rows = await seedRoster(event.id, event.currentGameId!, [
      { name: "Alice", userId: user.id },
      { name: "P1" }, { name: "P2" }, { name: "P3" }, { name: "P4" },
    ]);

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: rows[0].player.id,
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
    const rows = await seedRoster(event.id, event.currentGameId!, [
      { name: "Alice", userId: user.id },
      { name: "P1" }, { name: "P2" }, { name: "P3" }, { name: "P4" },
      { name: "Bench1" },
    ]);

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: rows[0].player.id,
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
    const rows = await seedRoster(event.id, event.currentGameId!, [
      { name: "Alice", userId: user.id },
      { name: "P1" }, { name: "P2" }, { name: "P3" }, { name: "P4" },
    ]);

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: rows[0].player.id,
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
    const rows = await seedRoster(event.id, event.currentGameId!, [
      { name: "A0" }, { name: "A1" }, { name: "A2" }, { name: "A3" }, { name: "A4" },
      { name: "Alice", userId: user.id }, // bench
    ]);

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: rows[5].player.id,
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

describe("archiveAndLeave — webhook spotsLeft payload (#722)", () => {
  it("reports spots left AFTER the active player leaves (no bench)", async () => {
    const user = await seedUser("João Fernandes", "u-joao");
    const event = await prisma.event.create({
      data: {
        title: "Game",
        location: "Pitch",
        dateTime: new Date(Date.now() + 7 * 86400_000),
        ownerId: null,
        maxPlayers: 8,
      },
    });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
    const rows = await seedRoster(event.id, game.id, [
      { name: "João Fernandes", userId: user.id },
      { name: "Other" },
    ]);

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: rows[0].player.id,
    });

    expect(fireWebhooks).toHaveBeenCalledWith(
      event.id,
      "player_left",
      expect.objectContaining({ playerName: "João Fernandes", spotsLeft: 7 }),
    );
  });

  it("reports game-scoped spotsLeft on a recurring event whose legacy Player rows exceed maxPlayers (#722)", async () => {
    const user = await seedUser("João Fernandes", "u-joao");
    const event = await prisma.event.create({
      data: {
        title: "Game",
        location: "Pitch",
        dateTime: new Date(Date.now() + 7 * 86400_000),
        ownerId: null,
        maxPlayers: 8,
        isRecurring: true,
      },
    });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

    // Legacy Player rows accumulate across occurrences (ADR 0016): 10 rows even
    // though only 2 players RSVP'd to the current game.
    const joao = await prisma.player.create({
      data: { eventId: event.id, name: "João Fernandes", userId: user.id, order: 0 },
    });
    await prisma.player.create({ data: { eventId: event.id, name: "Other", order: 1 } });
    for (let i = 2; i < 10; i++) {
      await prisma.player.create({ data: { eventId: event.id, name: `Historic${i}`, order: i } });
    }
    const joaoEp = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "João Fernandes", userId: user.id },
    });
    const otherEp = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Other" } });
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: joaoEp.id, order: 0 } });
    await prisma.gameParticipant.create({ data: { gameId: game.id, eventPlayerId: otherEp.id, order: 1 } });

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: joao.id,
    });

    // Current game had 2 players → 6 free before → 7 after João leaves.
    expect(fireWebhooks).toHaveBeenCalledWith(
      event.id,
      "player_left",
      expect.objectContaining({ playerName: "João Fernandes", spotsLeft: 7 }),
    );
  });

  it("reports spotsLeft 0 when the slot is immediately refilled by a bench player", async () => {
    const user = await seedUser("Alice", "u-alice");
    const event = await prisma.event.create({
      data: {
        title: "Game",
        location: "Pitch",
        dateTime: new Date(Date.now() + 7 * 86400_000),
        ownerId: null,
        maxPlayers: 2,
      },
    });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
    const rows = await seedRoster(event.id, game.id, [
      { name: "Alice", userId: user.id },
      { name: "Bob" },
      { name: "Bench" },
    ]);

    await archiveAndLeave({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
      playerId: rows[0].player.id,
    });

    expect(fireWebhooks).toHaveBeenCalledWith(
      event.id,
      "player_left",
      expect.objectContaining({ playerName: "Alice", spotsLeft: 0 }),
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
