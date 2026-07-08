import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

import {
  getEventsNeedingRecruitment48h,
  getEventsNeedingRecruitment24h,
  markRecruitment48hSent,
  markRecruitment24hSent,
  resetRecruitmentFlags,
} from "~/lib/rsvp.server";

function eid() { return `e-${Math.random().toString(36).slice(2, 8)}`; }

beforeEach(async () => {
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

async function seedEvent(overrides: Record<string, unknown> = {}) {
  return prisma.event.create({
    data: {
      id: eid(),
      title: "Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + 48 * 3600_000), // 48h from now
      maxPlayers: 10,
      rsvpCutoffSent: true,
      ...overrides,
    },
  });
}

describe("getEventsNeedingRecruitment48h", () => {
  it("returns events in the 48h window that haven't had recruitment sent", async () => {
    const now = new Date();
    const event = await seedEvent({
      dateTime: new Date(now.getTime() + 48 * 3600_000),
      recruitment48hSent: false,
    });

    const results = await getEventsNeedingRecruitment48h(now);
    expect(results.map((e) => e.id)).toContain(event.id);
  });

  it("excludes events that already had recruitment48hSent", async () => {
    const now = new Date();
    await seedEvent({
      dateTime: new Date(now.getTime() + 48 * 3600_000),
      recruitment48hSent: true,
    });

    const results = await getEventsNeedingRecruitment48h(now);
    expect(results).toHaveLength(0);
  });

  it("excludes events without rsvpCutoffSent", async () => {
    const now = new Date();
    await seedEvent({
      dateTime: new Date(now.getTime() + 48 * 3600_000),
      rsvpCutoffSent: false,
    });

    const results = await getEventsNeedingRecruitment48h(now);
    expect(results).toHaveLength(0);
  });
});

describe("getEventsNeedingRecruitment24h", () => {
  it("returns events in the 24h window", async () => {
    const now = new Date();
    const event = await seedEvent({
      dateTime: new Date(now.getTime() + 24 * 3600_000),
      recruitment24hSent: false,
    });

    const results = await getEventsNeedingRecruitment24h(now);
    expect(results.map((e) => e.id)).toContain(event.id);
  });

  it("excludes events that already had recruitment24hSent", async () => {
    const now = new Date();
    await seedEvent({
      dateTime: new Date(now.getTime() + 24 * 3600_000),
      recruitment24hSent: true,
    });

    const results = await getEventsNeedingRecruitment24h(now);
    expect(results).toHaveLength(0);
  });
});

describe("markRecruitment48hSent", () => {
  it("sets recruitment48hSent to true", async () => {
    const event = await seedEvent({ recruitment48hSent: false });

    await markRecruitment48hSent(event.id);

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.recruitment48hSent).toBe(true);
  });
});

describe("markRecruitment24hSent", () => {
  it("sets recruitment24hSent to true", async () => {
    const event = await seedEvent({ recruitment24hSent: false });

    await markRecruitment24hSent(event.id);

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.recruitment24hSent).toBe(true);
  });
});

describe("resetRecruitmentFlags", () => {
  it("resets both recruitment flags to false", async () => {
    const event = await seedEvent({ recruitment48hSent: true, recruitment24hSent: true });

    await resetRecruitmentFlags(event.id);

    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.recruitment48hSent).toBe(false);
    expect(updated?.recruitment24hSent).toBe(false);
  });
});
