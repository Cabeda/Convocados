import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

const mockGetSession = vi.fn();
const mockAuthenticateRequest = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: (...args: any[]) => mockAuthenticateRequest(...args),
}));

vi.mock("~/lib/db.server", () => {
  const { PrismaClient: PC } = require("@prisma/client");
  const p = new PC({ datasources: { db: { url: process.env.DATABASE_URL } } });
  return { prisma: p };
});

import { GET, POST } from "~/pages/api/me/notifications";

const userId = "user-notif-test-1";

function getCtx(query = "") {
  const request = new Request(`http://localhost/api/me/notifications${query}`, { method: "GET" });
  return { request } as any;
}

function postCtx(body: unknown) {
  const request = new Request("http://localhost/api/me/notifications/read", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request } as any;
}

beforeEach(async () => {
  await testPrisma.inAppNotification.deleteMany();
  await testPrisma.session.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.user.deleteMany();
  await testPrisma.user.create({ data: { id: userId, name: "Tester", email: "notif@test.com" } });
  mockGetSession.mockReset();
  mockGetSession.mockResolvedValue({ user: { id: userId, name: "Tester" } });
  mockAuthenticateRequest.mockReset();
  mockAuthenticateRequest.mockResolvedValue(null);
});

describe("GET /api/me/notifications", () => {
  it("returns empty feed for new user", async () => {
    const res = await GET(getCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.notifications).toHaveLength(0);
    expect(body.unreadCount).toBe(0);
  });

  it("returns notifications ordered by createdAt desc", async () => {
    await testPrisma.inAppNotification.createMany({
      data: [
        { userId, type: "player_joined", title: "Game", body: "A joined", createdAt: new Date("2026-01-01") },
        { userId, type: "player_left", title: "Game", body: "B left", createdAt: new Date("2026-01-02") },
      ],
    });
    const res = await GET(getCtx());
    const body = await res.json();
    expect(body.notifications).toHaveLength(2);
    expect(body.notifications[0].body).toBe("B left");
    expect(body.unreadCount).toBe(2);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getCtx());
    expect(res.status).toBe(401);
  });
});

describe("POST /api/me/notifications (mark read)", () => {
  it("marks specific notifications as read", async () => {
    const n = await testPrisma.inAppNotification.create({
      data: { userId, type: "game_full", title: "Game", body: "Full" },
    });
    const res = await POST(postCtx({ ids: [n.id] }));
    expect(res.status).toBe(200);
    const updated = await testPrisma.inAppNotification.findUnique({ where: { id: n.id } });
    expect(updated?.readAt).not.toBeNull();
  });

  it("marks all as read when no ids provided", async () => {
    await testPrisma.inAppNotification.createMany({
      data: [
        { userId, type: "reminder", title: "G", body: "B" },
        { userId, type: "spot_available", title: "G", body: "C" },
      ],
    });
    const res = await POST(postCtx({}));
    expect(res.status).toBe(200);
    const unread = await testPrisma.inAppNotification.count({ where: { userId, readAt: null } });
    expect(unread).toBe(0);
  });

  it("returns 401 when unauthenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(postCtx({}));
    expect(res.status).toBe(401);
  });
});
