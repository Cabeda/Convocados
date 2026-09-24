import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const mockAuth = vi.fn();
vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuth(...args),
}));

import { POST } from "~/pages/api/me/app-open";

function ctx(body?: unknown) {
  return {
    request: new Request("http://localhost/api/me/app-open", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  } as any;
}

async function seedUser() {
  return prisma.user.create({
    data: { id: `u-${Math.random().toString(36).slice(2, 8)}`, name: "Native", email: `${Math.random().toString(36).slice(2, 8)}@t.com`, emailVerified: true },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  resetApiRateLimitStore();
  await prisma.userAppOpen.deleteMany();
  await prisma.user.deleteMany();
});

describe("POST /api/me/app-open", () => {
  it("returns 401 without auth", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(ctx());
    expect(res.status).toBe(401);
  });

  it("records one app-open row for the authenticated native caller", async () => {
    const user = await seedUser();
    mockAuth.mockResolvedValue({ userId: user.id, scopes: [], authMethod: "oauth", clientId: "c1" });

    const res = await POST(ctx({ platform: "android" }));
    expect(res.status).toBe(200);

    const rows = await prisma.userAppOpen.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0].platform).toBe("android");
  });

  it("records the platform from the body (ios), defaulting to android", async () => {
    const iosUser = await seedUser();
    const legacyUser = await seedUser();
    mockAuth.mockResolvedValueOnce({ userId: iosUser.id, scopes: [], authMethod: "oauth", clientId: "c1" });
    await POST(ctx({ platform: "ios" }));
    mockAuth.mockResolvedValueOnce({ userId: legacyUser.id, scopes: [], authMethod: "oauth", clientId: "c1" });
    await POST(ctx()); // older clients send no body

    expect((await prisma.userAppOpen.findFirstOrThrow({ where: { userId: iosUser.id } })).platform).toBe("ios");
    expect((await prisma.userAppOpen.findFirstOrThrow({ where: { userId: legacyUser.id } })).platform).toBe("android");
  });

  it("is idempotent per UTC day", async () => {
    const user = await seedUser();
    mockAuth.mockResolvedValue({ userId: user.id, scopes: [], authMethod: "oauth", clientId: "c1" });

    await POST(ctx());
    await POST(ctx());
    await POST(ctx());

    const rows = await prisma.userAppOpen.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });
});
