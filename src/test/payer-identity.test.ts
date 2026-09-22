import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import {
  systemUserId,
  resolveLinkedUserId,
  ensureSystemUserId,
  resolvePayerUserId,
} from "~/lib/payerIdentity.server";

let eventId = "";

beforeEach(async () => {
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  const event = await prisma.event.create({
    data: { title: "Identity", location: "P", dateTime: new Date(), teamOneName: "A", teamTwoName: "B" },
  });
  eventId = event.id;
});

describe("payerIdentity", () => {
  it("formats the synthetic system user id", () => {
    expect(systemUserId("evt", "Ana")).toBe("system:evt:Ana");
  });

  it("resolves a linked EventPlayer account", async () => {
    const user = await prisma.user.create({ data: { id: "u1", name: "Ana", email: "a@test.com", emailVerified: false } });
    await prisma.eventPlayer.create({ data: { eventId, name: "Ana", userId: user.id } });
    expect(await resolveLinkedUserId(eventId, "Ana")).toBe("u1");
  });

  it("falls back to the legacy Player account", async () => {
    const user = await prisma.user.create({ data: { id: "u2", name: "Bob", email: "b@test.com", emailVerified: false } });
    await prisma.player.create({ data: { eventId, name: "Bob", order: 0, userId: user.id } });
    expect(await resolveLinkedUserId(eventId, "Bob")).toBe("u2");
  });

  it("returns null for an unlinked player", async () => {
    await prisma.eventPlayer.create({ data: { eventId, name: "Guest" } });
    expect(await resolveLinkedUserId(eventId, "Guest")).toBeNull();
  });

  it("creates a synthetic system user for an unlinked player, idempotently", async () => {
    const first = await ensureSystemUserId(eventId, "Guest");
    const second = await ensureSystemUserId(eventId, "Guest");
    expect(first).toBe(`system:${eventId}:Guest`);
    expect(second).toBe(first);
    expect(await prisma.user.count({ where: { id: first } })).toBe(1);
  });

  it("prefers the linked account, else the synthetic user", async () => {
    const user = await prisma.user.create({ data: { id: "u3", name: "Cara", email: "c@test.com", emailVerified: false } });
    await prisma.eventPlayer.create({ data: { eventId, name: "Cara", userId: user.id } });
    expect(await resolvePayerUserId(eventId, "Cara")).toBe("u3");
    expect(await resolvePayerUserId(eventId, "Stranger")).toBe(`system:${eventId}:Stranger`);
  });
});
