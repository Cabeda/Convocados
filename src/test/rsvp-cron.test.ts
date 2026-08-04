import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { upsertRsvp, getRsvpSummary, getRsvpRecipients } from "~/lib/rsvp.server";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

beforeEach(async () => {
  await prisma.rsvp.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

async function seedUser(name: string) {
  return prisma.user.create({
    data: { id: `u-${name}`, name, email: `${name}@t.com`, emailVerified: true },
  });
}

async function seedEvent(dateTime: Date, ownerId: string | null) {
  const event = await prisma.event.create({
    data: { title: "Game", location: "Pitch", dateTime, ownerId },
  });
  const game = await prisma.game.create({ data: { eventId: event.id, dateTime } });
  await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });
  return { ...event, currentGameId: game.id };
}

describe("RSVP 48h tick windowing", () => {
  it("fanout resolves exactly the expected recipients (players only)", async () => {
    const owner = await seedUser("Owner");
    const follower = await seedUser("Follower");
    const linked = await seedUser("Linked");
    const ghost = await seedUser("Ghost");
    const ev = await seedEvent(new Date(Date.now() + 48 * 3600_000), owner.id);
    await prisma.eventFollow.create({ data: { eventId: ev.id, userId: follower.id } });
    await prisma.player.create({ data: { eventId: ev.id, name: linked.name, userId: linked.id, order: 0 } });
    await prisma.player.create({ data: { eventId: ev.id, name: "Guest", order: 1 } });

    const recipients = await getRsvpRecipients(ev.id);
    // #656: follower is not a player → excluded from the "Are you coming" ping
    expect(recipients.sort()).toEqual([owner.id, linked.id].sort());
    // ghost has no follow + no player link
    expect(recipients).not.toContain(ghost.id);
    expect(recipients).not.toContain(follower.id);
  });

  it("summary counts yes/no/pending across game participants only", async () => {
    const owner = await seedUser("Owner");
    const follower = await seedUser("Follower");
    const linked = await seedUser("Linked");
    const ev = await seedEvent(new Date(Date.now() + 48 * 3600_000), owner.id);
    await prisma.eventFollow.create({ data: { eventId: ev.id, userId: follower.id } });
    await prisma.player.create({ data: { eventId: ev.id, name: linked.name, userId: linked.id, order: 0 } });

    await upsertRsvp(ev.id, follower.id, "yes");
    await upsertRsvp(ev.id, linked.id, "no");

    const summary = await getRsvpSummary(ev.id);
    // #656: follower is not a game participant → their RSVP is ignored
    expect(summary.yes).toBe(0);
    expect(summary.no).toBe(1);
    expect(summary.pending).toBe(1);
    expect(summary.noUserIds).toEqual([linked.id]);
    expect(summary.pendingUserIds).toEqual([owner.id]);
  });
});
