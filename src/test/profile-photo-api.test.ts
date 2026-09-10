import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient();

const mockGetSession = vi.fn();
const mockAuthenticateRequest = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));

vi.mock("~/lib/authenticate.server", () => ({
  authenticateRequest: (...args: unknown[]) => mockAuthenticateRequest(...args),
}));

vi.mock("~/lib/logger.server", () => {
  const noop = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
  return { logger: noop, createLogger: () => noop };
});

vi.mock("~/lib/db.server", async () => {
  const { PrismaClient: PC } = await import("~/lib/prisma-client");
  const p = new PC();
  return { prisma: p };
});

import { POST as setPhoto, DELETE as deletePhoto } from "~/pages/api/me/photo";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const VALID = "data:image/webp;base64,AAAA";

function ctx(method: string, body?: unknown) {
  const request = new Request("http://localhost/api/me/photo", {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, params: {} } as never;
}

async function seedUser() {
  const id = `photo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return testPrisma.user.create({
    data: { id, name: "Photo User", email: `${id}@test.com` },
  });
}

function mockSession(userId: string) {
  mockGetSession.mockResolvedValue({ user: { id: userId, name: "Photo User", email: "p@test.com" } });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  mockAuthenticateRequest.mockResolvedValue(null);
  await resetApiRateLimitStore();
  await testPrisma.user.deleteMany();
});

describe("POST /api/me/photo", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await setPhoto(ctx("POST", { image: VALID }));
    expect(res.status).toBe(401);
  });

  it("returns 400 for a missing image", async () => {
    const user = await seedUser();
    mockSession(user.id);
    const res = await setPhoto(ctx("POST", {}));
    expect(res.status).toBe(400);
  });

  it("returns 400 for a disallowed MIME type", async () => {
    const user = await seedUser();
    mockSession(user.id);
    const res = await setPhoto(ctx("POST", { image: "data:image/gif;base64,AAAA" }));
    expect(res.status).toBe(400);
  });

  it("returns 400 for an oversized image", async () => {
    const user = await seedUser();
    mockSession(user.id);
    const payload = "A".repeat(700_000);
    const res = await setPhoto(ctx("POST", { image: `data:image/png;base64,${payload}` }));
    expect(res.status).toBe(400);
  });

  it("stores the image and returns it", async () => {
    const user = await seedUser();
    mockSession(user.id);

    const res = await setPhoto(ctx("POST", { image: VALID }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.image).toBe(VALID);

    const stored = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.image).toBe(VALID);
  });

  it("accepts a bearer-token authenticated request", async () => {
    const user = await seedUser();
    mockGetSession.mockResolvedValue(null);
    mockAuthenticateRequest.mockResolvedValue({
      userId: user.id,
      scopes: ["*"],
      authMethod: "oauth",
    });

    const res = await setPhoto(ctx("POST", { image: VALID }));
    expect(res.status).toBe(200);
    const stored = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.image).toBe(VALID);
  });
});

describe("DELETE /api/me/photo", () => {
  it("returns 401 when unauthenticated", async () => {
    const res = await deletePhoto(ctx("DELETE"));
    expect(res.status).toBe(401);
  });

  it("clears the stored image", async () => {
    const user = await seedUser();
    await testPrisma.user.update({ where: { id: user.id }, data: { image: VALID } });
    mockSession(user.id);

    const res = await deletePhoto(ctx("DELETE"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.image).toBeNull();

    const stored = await testPrisma.user.findUnique({ where: { id: user.id } });
    expect(stored?.image).toBeNull();
  });
});
