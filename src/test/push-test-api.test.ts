import { describe, it, expect, beforeEach, vi } from "vitest";
import { POST } from "~/pages/api/push/test";
import { prisma } from "~/lib/db.server";
import { getSession } from "~/lib/auth.helpers.server";
import * as pushModule from "~/lib/push.server";

vi.mock("~/lib/db.server", () => ({
  prisma: {
    pushSubscription: { findMany: vi.fn() },
  },
}));

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

vi.mock("~/lib/push.server", () => ({
  sendTestPushToUserWebSubs: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);
const mockFindMany = vi.mocked(prisma.pushSubscription.findMany);
const mockSendTest = vi.mocked(pushModule.sendTestPushToUserWebSubs);

beforeEach(() => {
  vi.clearAllMocks();
});

function ctx() {
  return { request: new Request("http://localhost/api/push/test", { method: "POST" }) } as any;
}

describe("POST /api/push/test", () => {
  it("returns 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await POST(ctx());
    expect(res.status).toBe(401);
  });

  it("returns 200 with delivered=0 and total=0 when user has no subscriptions", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1" } } as any);
    mockFindMany.mockResolvedValue([]);

    const res = await POST(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.delivered).toBe(0);
    expect(body.total).toBe(0);
    expect(mockSendTest).not.toHaveBeenCalled();
  });

  it("sends a test push to the caller and returns the count", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1" } } as any);
    mockFindMany.mockResolvedValue([
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/1", p256dh: "p1", auth: "a1", locale: "en", createdAt: new Date() },
      { id: "s2", userId: "u1", endpoint: "https://push.example.com/2", p256dh: "p2", auth: "a2", locale: "pt", createdAt: new Date() },
    ] as any);
    mockSendTest.mockResolvedValue({ delivered: 2, total: 2 });

    const res = await POST(ctx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.delivered).toBe(2);
    expect(body.total).toBe(2);
    expect(mockSendTest).toHaveBeenCalledTimes(1);
    const arg = mockSendTest.mock.calls[0]?.[0];
    expect(arg?.userId).toBe("u1");
    expect(arg?.title).toContain("Convocados");
    expect(arg?.body).toBeTruthy();
  });

  it("returns delivered=0 when helper reports no successful sends", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "u1" } } as any);
    mockFindMany.mockResolvedValue([
      { id: "s1", userId: "u1", endpoint: "https://push.example.com/1", p256dh: "p1", auth: "a1", locale: "en", createdAt: new Date() },
    ] as any);
    mockSendTest.mockResolvedValue({ delivered: 0, total: 1 });

    const res = await POST(ctx());
    const body = await res.json();
    expect(body.delivered).toBe(0);
    expect(body.total).toBe(1);
  });
});
