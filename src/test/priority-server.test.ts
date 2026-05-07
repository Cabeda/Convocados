import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  confirmSpot,
  declineSpot,
  expireUnconfirmed,
  createConfirmations,
  getPendingConfirmations,
  getConfirmations,
  getUserConfirmation,
  recordNoShow,
  resetNoShowStreak,
} from "~/lib/priority.server";

beforeEach(async () => {
  await prisma.priorityConfirmation.deleteMany();
  await prisma.priorityEnrollment.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

async function seedEventAndUser() {
  const user = await prisma.user.create({
    data: { id: "prio-u1", name: "Player", email: "p@t.com", emailVerified: true },
  });
  const event = await prisma.event.create({
    data: {
      title: "Priority Game", location: "Pitch", dateTime: new Date(Date.now() + 86400000),
      maxPlayers: 10, priorityEnabled: true, priorityThreshold: 70,
      priorityWindow: 10, priorityMaxPercent: 50, priorityDeadlineHours: 24, priorityMinGames: 3,
    },
  });
  await prisma.priorityEnrollment.create({
    data: { eventId: event.id, userId: user.id, source: "auto", optedIn: true },
  });
  return { user, event };
}

describe("createConfirmations", () => {
  it("creates pending confirmations for users", async () => {
    const { user, event } = await seedEventAndUser();
    const deadline = new Date(Date.now() + 86400000);
    const result = await createConfirmations(event.id, [user.id], event.dateTime, deadline);
    expect(result.count).toBe(1);
  });

  it("handles duplicate confirmations gracefully", async () => {
    const { user, event } = await seedEventAndUser();
    const deadline = new Date(Date.now() + 86400000);
    await createConfirmations(event.id, [user.id], event.dateTime, deadline);
    // Second call should not fail
    const result = await createConfirmations(event.id, [user.id], event.dateTime, deadline);
    expect(result.count).toBe(1);
  });
});

describe("confirmSpot", () => {
  it("returns null when no confirmation exists", async () => {
    const { user, event } = await seedEventAndUser();
    const result = await confirmSpot(event.id, user.id, event.dateTime);
    expect(result).toBeNull();
  });

  it("confirms a pending spot", async () => {
    const { user, event } = await seedEventAndUser();
    const deadline = new Date(Date.now() + 86400000);
    await createConfirmations(event.id, [user.id], event.dateTime, deadline);

    const result = await confirmSpot(event.id, user.id, event.dateTime);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("confirmed");
  });

  it("returns existing confirmation if already confirmed", async () => {
    const { user, event } = await seedEventAndUser();
    const deadline = new Date(Date.now() + 86400000);
    await createConfirmations(event.id, [user.id], event.dateTime, deadline);
    await confirmSpot(event.id, user.id, event.dateTime);

    // Second confirm returns the already-confirmed record
    const result = await confirmSpot(event.id, user.id, event.dateTime);
    expect(result!.status).toBe("confirmed");
  });

  it("resets decline streak on confirm", async () => {
    const { user, event } = await seedEventAndUser();
    // Set a decline streak
    await prisma.priorityEnrollment.updateMany({
      where: { eventId: event.id, userId: user.id },
      data: { declineStreak: 3 },
    });
    const deadline = new Date(Date.now() + 86400000);
    await createConfirmations(event.id, [user.id], event.dateTime, deadline);
    await confirmSpot(event.id, user.id, event.dateTime);

    const enrollment = await prisma.priorityEnrollment.findFirst({
      where: { eventId: event.id, userId: user.id },
    });
    expect(enrollment!.declineStreak).toBe(0);
  });
});

describe("declineSpot", () => {
  it("returns null when no confirmation exists", async () => {
    const { user, event } = await seedEventAndUser();
    const result = await declineSpot(event.id, user.id, event.dateTime);
    expect(result).toBeNull();
  });

  it("declines a pending spot", async () => {
    const { user, event } = await seedEventAndUser();
    const deadline = new Date(Date.now() + 86400000);
    await createConfirmations(event.id, [user.id], event.dateTime, deadline);

    const result = await declineSpot(event.id, user.id, event.dateTime);
    expect(result).not.toBeNull();
    expect(result!.status).toBe("declined");
  });

  it("increments decline streak", async () => {
    const { user, event } = await seedEventAndUser();
    const deadline = new Date(Date.now() + 86400000);
    await createConfirmations(event.id, [user.id], event.dateTime, deadline);
    await declineSpot(event.id, user.id, event.dateTime);

    const enrollment = await prisma.priorityEnrollment.findFirst({
      where: { eventId: event.id, userId: user.id },
    });
    expect(enrollment!.declineStreak).toBe(1);
  });

  it("returns existing confirmation if already declined", async () => {
    const { user, event } = await seedEventAndUser();
    const deadline = new Date(Date.now() + 86400000);
    await createConfirmations(event.id, [user.id], event.dateTime, deadline);
    await declineSpot(event.id, user.id, event.dateTime);

    const result = await declineSpot(event.id, user.id, event.dateTime);
    expect(result!.status).toBe("declined");
  });
});

describe("expireUnconfirmed", () => {
  it("expires confirmations past deadline", async () => {
    const { user, event } = await seedEventAndUser();
    const pastDeadline = new Date(Date.now() - 1000);
    await createConfirmations(event.id, [user.id], event.dateTime, pastDeadline);

    const count = await expireUnconfirmed();
    expect(count).toBe(1);
  });

  it("does not expire confirmations before deadline", async () => {
    const { user, event } = await seedEventAndUser();
    const futureDeadline = new Date(Date.now() + 86400000);
    await createConfirmations(event.id, [user.id], event.dateTime, futureDeadline);

    const count = await expireUnconfirmed();
    expect(count).toBe(0);
  });
});

describe("getPendingConfirmations", () => {
  it("returns pending confirmations for event", async () => {
    const { user, event } = await seedEventAndUser();
    const deadline = new Date(Date.now() + 86400000);
    await createConfirmations(event.id, [user.id], event.dateTime, deadline);

    const pending = await getPendingConfirmations(event.id, event.dateTime);
    expect(pending).toHaveLength(1);
    expect(pending[0].user.name).toBe("Player");
  });
});

describe("getConfirmations", () => {
  it("returns all confirmations for event", async () => {
    const { user, event } = await seedEventAndUser();
    const deadline = new Date(Date.now() + 86400000);
    await createConfirmations(event.id, [user.id], event.dateTime, deadline);
    await confirmSpot(event.id, user.id, event.dateTime);

    const all = await getConfirmations(event.id, event.dateTime);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("confirmed");
  });
});

describe("getUserConfirmation", () => {
  it("returns user confirmation", async () => {
    const { user, event } = await seedEventAndUser();
    const deadline = new Date(Date.now() + 86400000);
    await createConfirmations(event.id, [user.id], event.dateTime, deadline);

    const conf = await getUserConfirmation(event.id, user.id, event.dateTime);
    expect(conf).not.toBeNull();
    expect(conf!.status).toBe("pending");
  });

  it("returns null when no confirmation", async () => {
    const { user, event } = await seedEventAndUser();
    const conf = await getUserConfirmation(event.id, user.id, event.dateTime);
    expect(conf).toBeNull();
  });
});

describe("recordNoShow / resetNoShowStreak", () => {
  it("increments no-show streak", async () => {
    const { user, event } = await seedEventAndUser();
    await recordNoShow(event.id, user.id);
    const enrollment = await prisma.priorityEnrollment.findFirst({
      where: { eventId: event.id, userId: user.id },
    });
    expect(enrollment!.noShowStreak).toBe(1);
  });

  it("resets no-show streak", async () => {
    const { user, event } = await seedEventAndUser();
    await recordNoShow(event.id, user.id);
    await resetNoShowStreak(event.id, user.id);
    const enrollment = await prisma.priorityEnrollment.findFirst({
      where: { eventId: event.id, userId: user.id },
    });
    expect(enrollment!.noShowStreak).toBe(0);
  });
});
