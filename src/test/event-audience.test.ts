import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resolveEventAudience, isPingSuppressedType } from "~/lib/eventAudience.server";

let ownerId = "";
let followerA = "";
let followerB = "";
let optedOutUser = "";

async function seedUser(prefix: string) {
  const id = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await prisma.user.create({
    data: { id, name: prefix, email: `${id}@test.com`, emailVerified: false },
  });
  return id;
}

beforeEach(async () => {
  await prisma.eventPlayer.deleteMany();
  await prisma.eventFollow.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  ownerId = await seedUser("owner");
  followerA = await seedUser("fa");
  followerB = await seedUser("fb");
  optedOutUser = await seedUser("out");
});

describe("eventAudience", () => {
  it("includes followers and the owner", async () => {
    const event = await prisma.event.create({
      data: { title: "E", location: "P", dateTime: new Date(), teamOneName: "A", teamTwoName: "B", ownerId },
    });
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: followerA } });
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: followerB } });

    const audience = await resolveEventAudience(event.id);
    expect(new Set(audience.userIds)).toEqual(new Set([ownerId, followerA, followerB]));
    expect(audience.follows).toHaveLength(2);
    expect(audience.ownerId).toBe(ownerId);
  });

  it("removes explicit exclusions", async () => {
    const event = await prisma.event.create({
      data: { title: "E", location: "P", dateTime: new Date(), teamOneName: "A", teamTwoName: "B", ownerId },
    });
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: followerA } });

    const audience = await resolveEventAudience(event.id, { excludeUserIds: [ownerId, followerA] });
    expect(audience.userIds).toEqual([]);
  });

  it("can omit the owner", async () => {
    const event = await prisma.event.create({
      data: { title: "E", location: "P", dateTime: new Date(), teamOneName: "A", teamTwoName: "B", ownerId },
    });
    const audience = await resolveEventAudience(event.id, { includeOwner: false });
    expect(audience.userIds).toEqual([]);
  });

  it("suppresses opted-out and declined users for ping types", async () => {
    const event = await prisma.event.create({
      data: { title: "E", location: "P", dateTime: new Date(), teamOneName: "A", teamTwoName: "B", ownerId },
    });
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: followerA } });
    await prisma.eventFollow.create({ data: { eventId: event.id, userId: optedOutUser } });
    await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "OptedOut", userId: optedOutUser, invitationOptOutAt: new Date() },
    });

    const withoutSuppression = await resolveEventAudience(event.id);
    expect(withoutSuppression.userIds).toContain(optedOutUser);

    const withSuppression = await resolveEventAudience(event.id, { suppressPingDeclines: true });
    expect(withSuppression.userIds).not.toContain(optedOutUser);
    expect(withSuppression.userIds).toContain(followerA);
  });

  it("classifies ping-suppressed notification types", () => {
    expect(isPingSuppressedType("recruitment")).toBe(true);
    expect(isPingSuppressedType("few_spots_left")).toBe(true);
    expect(isPingSuppressedType("spot_available")).toBe(true);
    expect(isPingSuppressedType("player_joined")).toBe(false);
    expect(isPingSuppressedType("reminder")).toBe(false);
  });
});
