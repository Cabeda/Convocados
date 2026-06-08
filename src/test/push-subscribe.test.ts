import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const mockGetSession = vi.fn();
const mockAuthenticateRequest = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: vi.fn(),
}));

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: (...args: any[]) => mockAuthenticateRequest(...args),
}));

vi.mock("~/lib/db.server", () => {
  const { PrismaClient: PC } = require("@prisma/client");
  const p = new PC({ datasources: { db: { url: process.env.DATABASE_URL } } });
  return { prisma: p };
});

import { POST as subscribePush, DELETE as unsubscribePush } from "~/pages/api/push/subscribe";
import { POST as legacySubscribe, DELETE as legacyUnsubscribe } from "~/pages/api/events/[id]/push";
import { GET as getFollow, POST as followEvent, DELETE as unfollowEvent } from "~/pages/api/events/[id]/follow";

function ctx(params: Record<string, string>, body?: unknown, method = "POST") {
  const request = new Request("http://localhost/api/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params } as any;
}

function deleteCtx(params: Record<string, string>, body?: unknown) {
  return ctx(params, body, "DELETE");
}

async function seedEvent(id = "evt-sub-1") {
  await testPrisma.event.upsert({
    where: { id },
    create: { id, title: "Push Test", location: "Here", dateTime: new Date(), teamOneName: "A", teamTwoName: "B" },
    update: {},
  });
  return id;
}

const userId = "user-push-test-1";

beforeEach(async () => {
  await testPrisma.eventFollow.deleteMany();
  await testPrisma.pushSubscription.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.session.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.user.deleteMany();
  await testPrisma.user.create({ data: { id: userId, name: "Tester", email: "tester@test.com" } });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ user: { id: userId, name: "Tester" } });
  mockAuthenticateRequest.mockReset();
  mockAuthenticateRequest.mockResolvedValue(null);
});

// ─── POST /api/push/subscribe ────────────────────────────────────────────────

describe("POST /api/push/subscribe", () => {
  it("registers a push subscription", async () => {
    const res = await subscribePush(ctx({}, { endpoint: "https://push.example.com/s1", keys: { p256dh: "k", auth: "a" } }));
    expect(res.status).toBe(200);
    const sub = await testPrisma.pushSubscription.findFirst({ where: { userId } });
    expect(sub?.endpoint).toBe("https://push.example.com/s1");
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await subscribePush(ctx({}, { endpoint: "https://push.example.com/s2", keys: { p256dh: "k", auth: "a" } }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid subscription", async () => {
    const res = await subscribePush(ctx({}, { endpoint: "", keys: {} }));
    expect(res.status).toBe(400);
  });

  it("stores pt locale", async () => {
    await subscribePush(ctx({}, { endpoint: "https://push.example.com/pt", keys: { p256dh: "k", auth: "a" }, locale: "pt-BR" }));
    const sub = await testPrisma.pushSubscription.findFirst({ where: { userId } });
    expect(sub?.locale).toBe("pt");
  });

  it("upserts existing subscription", async () => {
    const payload = { endpoint: "https://push.example.com/upsert", keys: { p256dh: "k1", auth: "a1" } };
    await subscribePush(ctx({}, payload));
    await subscribePush(ctx({}, { ...payload, keys: { p256dh: "k2", auth: "a2" } }));
    const subs = await testPrisma.pushSubscription.findMany({ where: { userId } });
    expect(subs).toHaveLength(1);
    expect(subs[0].p256dh).toBe("k2");
  });
});

// ─── DELETE /api/push/subscribe ──────────────────────────────────────────────

describe("DELETE /api/push/subscribe", () => {
  it("removes a subscription", async () => {
    await testPrisma.pushSubscription.create({
      data: { userId, endpoint: "https://push.example.com/del", p256dh: "k", auth: "a", locale: "en" },
    });
    const res = await unsubscribePush(deleteCtx({}, { endpoint: "https://push.example.com/del" }));
    expect(res.status).toBe(200);
    const subs = await testPrisma.pushSubscription.findMany({ where: { userId } });
    expect(subs).toHaveLength(0);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await unsubscribePush(deleteCtx({}, { endpoint: "https://push.example.com/x" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing endpoint", async () => {
    const res = await unsubscribePush(deleteCtx({}, {}));
    expect(res.status).toBe(400);
  });
});

// ─── POST /api/events/[id]/push (legacy) ────────────────────────────────────

describe("POST /api/events/[id]/push (legacy)", () => {
  it("subscribes and auto-follows event", async () => {
    const id = await seedEvent();
    const res = await legacySubscribe(ctx({ id }, { endpoint: "https://push.example.com/leg1", keys: { p256dh: "k", auth: "a" }, locale: "en" }));
    expect(res.status).toBe(200);
    const follow = await testPrisma.eventFollow.findUnique({ where: { eventId_userId: { eventId: id, userId } } });
    expect(follow).not.toBeNull();
  });

  it("returns 404 for unknown event", async () => {
    const res = await legacySubscribe(ctx({ id: "nonexistent" }, { endpoint: "https://push.example.com/x", keys: { p256dh: "k", auth: "a" } }));
    expect(res.status).toBe(404);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const id = await seedEvent();
    const res = await legacySubscribe(ctx({ id }, { endpoint: "https://push.example.com/x", keys: { p256dh: "k", auth: "a" } }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for invalid subscription", async () => {
    const id = await seedEvent();
    const res = await legacySubscribe(ctx({ id }, { endpoint: "", keys: {} }));
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/events/[id]/push (legacy) ───────────────────────────────────

describe("DELETE /api/events/[id]/push (legacy)", () => {
  it("removes subscription", async () => {
    await testPrisma.pushSubscription.create({
      data: { userId, endpoint: "https://push.example.com/leg-del", p256dh: "k", auth: "a", locale: "en" },
    });
    const res = await legacyUnsubscribe(deleteCtx({}, { endpoint: "https://push.example.com/leg-del" }));
    expect(res.status).toBe(200);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await legacyUnsubscribe(deleteCtx({}, { endpoint: "x" }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for missing endpoint", async () => {
    const res = await legacyUnsubscribe(deleteCtx({}, {}));
    expect(res.status).toBe(400);
  });
});

// ─── GET/POST/DELETE /api/events/[id]/follow ─────────────────────────────────

describe("GET /api/events/[id]/follow", () => {
  it("returns following:false when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const id = await seedEvent();
    const res = await getFollow(ctx({ id }, undefined, "GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).following).toBe(false);
  });

  it("returns following:true when user follows the event", async () => {
    const id = await seedEvent();
    await testPrisma.eventFollow.create({ data: { eventId: id, userId } });
    const res = await getFollow(ctx({ id }, undefined, "GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).following).toBe(true);
  });

  it("returns following:false when user does not follow", async () => {
    const id = await seedEvent();
    const res = await getFollow(ctx({ id }, undefined, "GET"));
    expect(res.status).toBe(200);
    expect((await res.json()).following).toBe(false);
  });
});

describe("POST /api/events/[id]/follow", () => {
  it("follows an event", async () => {
    const id = await seedEvent();
    const res = await followEvent(ctx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.following).toBe(true);
    const follow = await testPrisma.eventFollow.findUnique({ where: { eventId_userId: { eventId: id, userId } } });
    expect(follow).not.toBeNull();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const id = await seedEvent();
    const res = await followEvent(ctx({ id }));
    expect(res.status).toBe(401);
  });

  it("returns 404 for nonexistent event", async () => {
    const res = await followEvent(ctx({ id: "nonexistent" }));
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/events/[id]/follow", () => {
  it("unfollows an event", async () => {
    const id = await seedEvent();
    await testPrisma.eventFollow.create({ data: { eventId: id, userId } });
    const res = await unfollowEvent(deleteCtx({ id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.following).toBe(false);
    const follow = await testPrisma.eventFollow.findUnique({ where: { eventId_userId: { eventId: id, userId } } });
    expect(follow).toBeNull();
  });

  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await unfollowEvent(deleteCtx({ id: "x" }));
    expect(res.status).toBe(401);
  });
});
