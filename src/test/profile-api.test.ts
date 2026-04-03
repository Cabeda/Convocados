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

import { GET } from "~/pages/api/me/profile";

const TEST_USER = {
  id: "profile-test-user",
  name: "Profile Test",
  email: "profile-test@example.com",
  emailVerified: true,
  role: "user",
  publicStats: true,
  profileVisibility: "public",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function ctx() {
  const request = new Request("http://localhost/api/me/profile");
  return { request, params: {}, redirect: () => new Response(), url: new URL("http://localhost"), props: {}, locals: {}, cookies: { get: () => undefined, set: () => {}, delete: () => {}, has: () => false, headers: () => new Headers() }, site: undefined, generator: "", currentLocale: undefined, preferredLocale: undefined, preferredLocaleList: undefined, rewrite: () => new Response(), originPathname: "/api/me/profile", isPrerendered: false, routePattern: "/api/me/profile", clientAddress: "127.0.0.1" } as any;
}

describe("GET /api/me/profile", () => {
  beforeEach(async () => {
    mockGetSession.mockReset();
    mockAuthenticateRequest.mockReset();
    await testPrisma.user.deleteMany({ where: { id: TEST_USER.id } });
  });

  it("returns 401 when not authenticated", async () => {
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue(null);
    const res = await GET(ctx());
    expect(res.status).toBe(401);
  });

  it("returns user profile via OAuth token", async () => {
    await testPrisma.user.create({ data: TEST_USER });
    mockAuthenticateRequest.mockResolvedValue({ userId: TEST_USER.id, scopes: ["profile"], authMethod: "oauth" });
    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(TEST_USER.id);
    expect(data.name).toBe(TEST_USER.name);
    expect(data.email).toBe(TEST_USER.email);
    // Should not expose sensitive fields
    expect(data.role).toBeUndefined();
    expect(data.password).toBeUndefined();
  });

  it("returns user profile via session", async () => {
    await testPrisma.user.create({ data: TEST_USER });
    mockAuthenticateRequest.mockResolvedValue(null);
    mockGetSession.mockResolvedValue({ user: { id: TEST_USER.id } });
    const res = await GET(ctx());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.id).toBe(TEST_USER.id);
  });

  it("returns 404 when user not found in DB", async () => {
    mockAuthenticateRequest.mockResolvedValue({ userId: "nonexistent-user", scopes: ["*"], authMethod: "session" });
    const res = await GET(ctx());
    expect(res.status).toBe(404);
  });
});
