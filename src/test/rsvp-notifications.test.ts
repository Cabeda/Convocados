import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { enqueueRsvpAnswerNotification } from "~/lib/rsvp-notifications.server";

beforeEach(async () => {
  await prisma.notificationJob.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

async function seedUser(overrides: Record<string, unknown> = {}) {
  return prisma.user.create({
    data: {
      id: `u-${Math.random().toString(36).slice(2, 8)}`,
      name: "Alice",
      email: `a-${Math.random().toString(36).slice(2, 8)}@t.com`,
      emailVerified: true,
      ...overrides,
    },
  });
}

async function seedEvent(ownerId: string | null) {
  return prisma.event.create({
    data: {
      id: `e-${Math.random().toString(36).slice(2, 8)}`,
      title: "Friday Game",
      location: "Pitch",
      dateTime: new Date(Date.now() + 7 * 86400_000),
      ownerId,
    },
  });
}

describe("enqueueRsvpAnswerNotification", () => {
  it("creates a job of type rsvp_request with the rich actor payload when actor is logged", async () => {
    const u = await seedUser({ name: "João" });
    const e = await seedEvent(null);

    await enqueueRsvpAnswerNotification({
      eventId: e.id,
      eventTitle: e.title,
      status: "yes",
      actorUserId: u.id,
      actorName: u.name,
      actorIsLogged: true,
    });

    const jobs = await prisma.notificationJob.findMany({ where: { eventId: e.id, type: "rsvp_request" } });
    expect(jobs).toHaveLength(1);
    const payload = JSON.parse(jobs[0].payload) as { key: string; params: Record<string, string>; title: string };
    expect(payload.key).toBe("notifyRsvpAnswerYes");
    expect(payload.params).toEqual({ name: "João", title: e.title });
    expect(payload.title).toBe(e.title);
    expect(jobs[0].senderClientId).toBe(u.id);
  });

  it("uses the generic (anon) key when the actor is not logged (e.g. admin sets a guest RSVP)", async () => {
    const owner = await seedUser({ name: "Owner" });
    const e = await seedEvent(owner.id);
    const guest = await prisma.player.create({ data: { eventId: e.id, name: "Guest", order: 0 } });

    await enqueueRsvpAnswerNotification({
      eventId: e.id,
      eventTitle: e.title,
      status: "no",
      actorPlayerId: guest.id,
      actorName: "Guest",
      actorIsLogged: false,
      senderClientId: owner.id,
    });

    const jobs = await prisma.notificationJob.findMany({ where: { eventId: e.id, type: "rsvp_request" } });
    expect(jobs).toHaveLength(1);
    const payload = JSON.parse(jobs[0].payload) as { key: string; params: Record<string, string> };
    expect(payload.key).toBe("notifyRsvpAnswerAnon");
    // No name in params for anon — generic text
    expect(payload.params).toEqual({ title: e.title });
    expect(payload.params.name).toBeUndefined();
  });

  it("selects the correct i18n key per status (yes / no / maybe)", async () => {
    const u = await seedUser({ name: "Maria" });
    const e = await seedEvent(null);

    await enqueueRsvpAnswerNotification({
      eventId: e.id,
      eventTitle: e.title,
      status: "maybe",
      actorUserId: u.id,
      actorName: u.name,
      actorIsLogged: true,
    });
    const jobs = await prisma.notificationJob.findMany({ where: { eventId: e.id, type: "rsvp_request" } });
    const payload = JSON.parse(jobs[0].payload) as { key: string };
    expect(payload.key).toBe("notifyRsvpAnswerMaybe");
  });

  it("dedups: latest answer replaces the prior unprocessed job for the same actor", async () => {
    const u = await seedUser({ name: "Eva" });
    const e = await seedEvent(null);

    await enqueueRsvpAnswerNotification({
      eventId: e.id,
      eventTitle: e.title,
      status: "yes",
      actorUserId: u.id,
      actorName: u.name,
      actorIsLogged: true,
    });
    await enqueueRsvpAnswerNotification({
      eventId: e.id,
      eventTitle: e.title,
      status: "no",
      actorUserId: u.id,
      actorName: u.name,
      actorIsLogged: true,
    });

    const jobs = await prisma.notificationJob.findMany({ where: { eventId: e.id, type: "rsvp_request" } });
    expect(jobs).toHaveLength(1);
    const payload = JSON.parse(jobs[0].payload) as { key: string };
    expect(payload.key).toBe("notifyRsvpAnswerNo");
  });

  it("does NOT dedup across different actors", async () => {
    const a = await seedUser({ name: "A" });
    const b = await seedUser({ name: "B" });
    const e = await seedEvent(null);

    await enqueueRsvpAnswerNotification({
      eventId: e.id,
      eventTitle: e.title,
      status: "yes",
      actorUserId: a.id,
      actorName: a.name,
      actorIsLogged: true,
    });
    await enqueueRsvpAnswerNotification({
      eventId: e.id,
      eventTitle: e.title,
      status: "no",
      actorUserId: b.id,
      actorName: b.name,
      actorIsLogged: true,
    });

    const jobs = await prisma.notificationJob.findMany({ where: { eventId: e.id, type: "rsvp_request" } });
    expect(jobs).toHaveLength(2);
  });

  it("no-ops when neither actorUserId nor actorPlayerId is provided", async () => {
    const e = await seedEvent(null);

    await enqueueRsvpAnswerNotification({
      eventId: e.id,
      eventTitle: e.title,
      status: "yes",
      actorName: "Ghost",
      actorIsLogged: false,
    });

    const jobs = await prisma.notificationJob.findMany({ where: { eventId: e.id, type: "rsvp_request" } });
    expect(jobs).toHaveLength(0);
  });
});
