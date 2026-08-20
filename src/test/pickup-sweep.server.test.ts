import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { createPickupEvent, archiveExpiredPickups } from "~/lib/pickupSweep.server";
import { getSportPreset } from "~/lib/sports";

beforeEach(async () => {
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

const slot = {
  resourceId: "court-1",
  resourceName: "Court 1",
  startTime: "19:30",
  durationMinutes: 90,
};

const input = {
  tenantId: "tenant-1",
  tenantName: "CJD Padel Academy",
  address: "Rua Dr. Lopo de Carvalho, Porto",
  coordinate: { lat: 41.176, lng: -8.58 },
  sport: "padel",
  date: "2026-06-18",
  slot,
  timezone: "Europe/Lisbon",
};

describe("createPickupEvent", () => {
  it("creates a public unowned one-off Event+Game with the expected fields", async () => {
    const preset = getSportPreset("padel");

    const { event: created, created: isNew } = await createPickupEvent(input);
    expect(isNew).toBe(true);

    const event = await prisma.event.findUnique({ where: { id: created.id } });
    expect(event).not.toBeNull();
    expect(event!.source).toBe("playtomic");
    expect(event!.sourceKey).toBe("tenant-1|court-1|2026-06-18|19:30");
    expect(event!.ownerId).toBeNull();
    expect(event!.isPublic).toBe(true);
    expect(event!.isRecurring).toBe(false);
    expect(event!.playtomicTenantId).toBe("tenant-1");
    expect(event!.playtomicTenantName).toBe("CJD Padel Academy");
    expect(event!.timezone).toBe("Europe/Lisbon");
    expect(event!.maxPlayers).toBe(preset.defaultMaxPlayers);
    expect(event!.durationMinutes).toBe(preset.defaultDurationMinutes);
    expect(event!.latitude).toBe(41.176);
    expect(event!.longitude).toBe(-8.58);
    // 19:30 Lisbon (WEST, UTC+1) in June = 18:30 UTC
    expect(event!.dateTime.toISOString()).toBe("2026-06-18T18:30:00.000Z");

    // Title: "<Sport> — <club> (<weekday> <time>)"
    expect(event!.title).toBe("Padel — CJD Padel Academy (Thu 19:30)");

    // One Game exists for the event and is the current game
    const game = await prisma.game.findUnique({ where: { id: event!.currentGameId! } });
    expect(game).not.toBeNull();
    expect(game!.eventId).toBe(event!.id);
    expect(game!.status).toBe("upcoming");
    expect(game!.dateTime.toISOString()).toBe("2026-06-18T18:30:00.000Z");
  });

  it("is idempotent: a second call for the same slot returns the existing event", async () => {
    const first = await createPickupEvent(input);
    const second = await createPickupEvent(input);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.event.id).toBe(first.event.id);
    expect(await prisma.event.count({ where: { sourceKey: first.event.sourceKey } })).toBe(1);
  });

  it("creates separate events for the same court at different times", async () => {
    const a = await createPickupEvent(input);
    const b = await createPickupEvent({
      ...input,
      slot: { ...slot, startTime: "20:00" },
    });

    expect(a.event.id).not.toBe(b.event.id);
    expect(await prisma.event.count()).toBe(2);
  });
});

describe("archiveExpiredPickups", () => {
  it("cancels the Game and archives an un-adopted pickup whose slot has passed", async () => {
    const { event: past } = await createPickupEvent(input);
    await prisma.event.update({ where: { id: past.id }, data: { dateTime: new Date(Date.now() - 3 * 3600_000) } });

    const archived = await archiveExpiredPickups({ graceMinutes: 120 });

    expect(archived).toBe(1);
    const event = await prisma.event.findUnique({ where: { id: past.id } });
    expect(event!.archivedAt).not.toBeNull();
    const game = await prisma.game.findUnique({ where: { id: event!.currentGameId! } });
    expect(game!.status).toBe("cancelled");
  });

  it("leaves adopted pickups untouched even after the slot passes", async () => {
    const { event: past } = await createPickupEvent(input);
    const owner = await prisma.user.create({ data: { id: "u1", name: "Owner", email: "o@t.com", emailVerified: true } });
    await prisma.event.update({
      where: { id: past.id },
      data: { ownerId: owner.id, dateTime: new Date(Date.now() - 3 * 3600_000) },
    });

    const archived = await archiveExpiredPickups({ graceMinutes: 120 });

    expect(archived).toBe(0);
    const event = await prisma.event.findUnique({ where: { id: past.id } });
    expect(event!.archivedAt).toBeNull();
  });

  it("leaves future pickups untouched", async () => {
    const { event: upcoming } = await createPickupEvent(input);
    await prisma.event.update({ where: { id: upcoming.id }, data: { dateTime: new Date(Date.now() + 24 * 3600_000) } });

    const archived = await archiveExpiredPickups({ graceMinutes: 120 });

    expect(archived).toBe(0);
    const event = await prisma.event.findUnique({ where: { id: upcoming.id } });
    expect(event!.archivedAt).toBeNull();
  });
});