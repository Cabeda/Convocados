import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

import { GET as getCost } from "~/pages/api/events/[id]/cost";
import { GET as getPayments } from "~/pages/api/events/[id]/payments";
import { GET as getUserProfile } from "~/pages/api/users/[id]/index";
import { validateWebhookUrl } from "~/lib/webhookUrl";

let ownerId = "";
let ownerToken = "";
let otherId = "";
let otherToken = "";
let participantId = "";
let participantToken = "";

async function seedUserWithToken(prefix: string) {
  const userId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await prisma.user.create({
    data: { id: userId, name: prefix, email: `${userId}@test.com`, emailVerified: false },
  });
  const clientId = `client-${userId}`;
  await prisma.oauthClient.create({ data: { id: clientId, clientId, redirectUris: "https://example.com/callback" } });
  const token = `tok-${userId}`;
  await prisma.oauthAccessToken.create({
    data: { id: `at-${userId}`, token, clientId, userId, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { userId, token };
}

async function seedEvent(ownerId: string | null, isPublic: boolean) {
  const event = await prisma.event.create({
    data: {
      title: "Finance Event",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
      teamOneName: "A",
      teamTwoName: "B",
      ownerId,
      isPublic,
    },
  });
  await prisma.eventCost.create({
    data: { eventId: event.id, totalAmount: 100, currency: "EUR" },
  });
  return event;
}

function ctx(params: Record<string, string>, token?: string, method = "GET") {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  const request = new Request("http://localhost/api/test", { method, headers });
  return { request, params, url: new URL(request.url) } as any;
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.playerPayment.deleteMany();
  await prisma.eventCost.deleteMany();
  await prisma.gameParticipant.deleteMany();
  await prisma.player.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.game.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  ({ userId: ownerId, token: ownerToken } = await seedUserWithToken("owner"));
  ({ userId: otherId, token: otherToken } = await seedUserWithToken("other"));
  ({ userId: participantId, token: participantToken } = await seedUserWithToken("participant"));
});

describe("GET /api/events/[id]/cost authorization", () => {
  it("allows the owner", async () => {
    const event = await seedEvent(ownerId, false);
    expect((await getCost(ctx({ id: event.id }, ownerToken))).status).toBe(200);
  });

  it("allows a participant", async () => {
    const event = await seedEvent(ownerId, false);
    await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Participant", userId: participantId } });
    expect((await getCost(ctx({ id: event.id }, participantToken))).status).toBe(200);
  });

  it("rejects an anonymous caller on an owned event", async () => {
    const event = await seedEvent(ownerId, false);
    expect((await getCost(ctx({ id: event.id }))).status).toBe(403);
  });

  it("rejects a non-participant authenticated caller", async () => {
    const event = await seedEvent(ownerId, false);
    expect((await getCost(ctx({ id: event.id }, otherToken))).status).toBe(403);
  });

  it("allows anonymous access on an ownerless UNLISTED event", async () => {
    const event = await seedEvent(null, false);
    expect((await getCost(ctx({ id: event.id }))).status).toBe(200);
  });

  it("rejects anonymous access on an ownerless PUBLIC event", async () => {
    const event = await seedEvent(null, true);
    expect((await getCost(ctx({ id: event.id }))).status).toBe(403);
  });
});

describe("GET /api/events/[id]/payments authorization", () => {
  it("allows the owner and rejects anonymous", async () => {
    const event = await seedEvent(ownerId, false);
    expect((await getPayments(ctx({ id: event.id }, ownerToken))).status).toBe(200);
    expect((await getPayments(ctx({ id: event.id }))).status).toBe(403);
  });
});

describe("GET /api/users/[id] profile visibility", () => {
  it("public profile is readable anonymously", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { profileVisibility: "public" } });
    expect((await getUserProfile(ctx({ id: ownerId }))).status).toBe(200);
  });

  it("private profile is hidden from others but visible to self", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { profileVisibility: "private" } });
    expect((await getUserProfile(ctx({ id: ownerId }, otherToken))).status).toBe(403);
    expect((await getUserProfile(ctx({ id: ownerId }))).status).toBe(403);
    expect((await getUserProfile(ctx({ id: ownerId }, ownerToken))).status).toBe(200);
  });

  it("participants-only profile requires a shared event", async () => {
    await prisma.user.update({ where: { id: ownerId }, data: { profileVisibility: "participants" } });
    // No shared event yet → hidden.
    expect((await getUserProfile(ctx({ id: ownerId }, otherToken))).status).toBe(403);

    // Give both users a Player row on the same event → visible.
    const event = await seedEvent(otherId, true);
    await prisma.player.createMany({
      data: [
        { name: "Owner", eventId: event.id, userId: ownerId },
        { name: "Other", eventId: event.id, userId: otherId },
      ],
    });
    expect((await getUserProfile(ctx({ id: ownerId }, otherToken))).status).toBe(200);
  });
});

describe("validateWebhookUrl", () => {
  it("accepts public http(s) URLs", () => {
    expect(validateWebhookUrl("https://example.com/hook")).toBeNull();
    expect(validateWebhookUrl("http://hooks.example.org/x")).toBeNull();
  });

  it("rejects loopback, private, link-local and metadata hosts", () => {
    for (const url of [
      "http://localhost/hook",
      "http://127.0.0.1/hook",
      "http://10.0.0.5/hook",
      "http://192.168.1.10/hook",
      "http://172.16.5.5/hook",
      "http://169.254.169.254/latest/meta-data",
      "http://service.internal/x",
      "http://[::1]/hook",
      "http://[fd00::1]/hook",
    ]) {
      expect(validateWebhookUrl(url), url).not.toBeNull();
    }
  });

  it("rejects non-http protocols and malformed URLs", () => {
    expect(validateWebhookUrl("ftp://example.com")).not.toBeNull();
    expect(validateWebhookUrl("not a url")).not.toBeNull();
  });
});
