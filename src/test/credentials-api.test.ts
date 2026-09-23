import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient();

const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
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

import { GET as listCredentials, DELETE as unlinkCredential } from "~/pages/api/me/credentials";

function listCtx() {
  const request = new Request("http://localhost/api/me/credentials", { method: "GET" });
  return { request, params: {} } as any;
}

function unlinkCtx(body?: unknown) {
  const request = new Request("http://localhost/api/me/credentials", {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params: {} } as any;
}

async function seedUser(overrides: Record<string, unknown> = {}) {
  const id = `cred-user-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return testPrisma.user.create({
    data: {
      id,
      name: "Credential User",
      email: `${id}@test.com`,
      emailVerified: true,
      ...overrides,
    },
  });
}

function mockAuth(userId: string) {
  mockGetSession.mockResolvedValue({
    user: { id: userId, name: "Credential User", email: `${userId}@test.com` },
  });
}

function mockAnonymous() {
  mockGetSession.mockResolvedValue(null);
}

async function seedCredentialAccount(userId: string) {
  return testPrisma.account.create({
    data: {
      id: `cred-acc-${userId}`,
      accountId: userId,
      providerId: "credential",
      issuer: "local:credential",
      userId,
      password: "hashed-x",
    },
  });
}

async function seedGoogleAccount(userId: string, sub: string) {
  return testPrisma.account.create({
    data: {
      id: `g-acc-${sub}`,
      accountId: sub,
      providerId: "google",
      issuer: "https://accounts.google.com",
      userId,
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockAnonymous();
  await testPrisma.session.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.user.deleteMany();
});

describe("GET /api/me/credentials", () => {
  it("401 when unauthenticated", async () => {
    const res = await listCredentials(listCtx());
    expect(res.status).toBe(401);
  });

  it("lists password and google credentials for the session user", async () => {
    const user = await seedUser();
    await seedCredentialAccount(user.id);
    await seedGoogleAccount(user.id, "sub-abc");
    mockAuth(user.id);

    const res = await listCredentials(listCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.credentials).toHaveLength(2);
    const providers = body.credentials.map((c: { providerId: string }) => c.providerId).sort();
    expect(providers).toEqual(["credential", "google"]);
    const google = body.credentials.find((c: { providerId: string }) => c.providerId === "google");
    expect(google.accountId).toBe("sub-abc");
    expect(google).not.toHaveProperty("password");
    expect(google).not.toHaveProperty("accessToken");
  });
});

describe("DELETE /api/me/credentials", () => {
  it("401 when unauthenticated", async () => {
    const res = await unlinkCredential(unlinkCtx({ accountId: "x" }));
    expect(res.status).toBe(401);
  });

  it("400 when accountId missing", async () => {
    const user = await seedUser();
    mockAuth(user.id);
    const res = await unlinkCredential(unlinkCtx({}));
    expect(res.status).toBe(400);
  });

  it("403 when unlinking the sole credential", async () => {
    const user = await seedUser();
    const acc = await seedCredentialAccount(user.id);
    mockAuth(user.id);

    const res = await unlinkCredential(unlinkCtx({ accountId: acc.id }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toContain("at least one");
    const still = await testPrisma.account.findUnique({ where: { id: acc.id } });
    expect(still).not.toBeNull();
  });

  it("unlinks google when a password credential remains", async () => {
    const user = await seedUser();
    await seedCredentialAccount(user.id);
    const google = await seedGoogleAccount(user.id, "sub-del");
    mockAuth(user.id);

    const res = await unlinkCredential(unlinkCtx({ accountId: google.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    const gone = await testPrisma.account.findUnique({ where: { id: google.id } });
    expect(gone).toBeNull();
    const password = await testPrisma.account.findFirst({
      where: { userId: user.id, providerId: "credential" },
    });
    expect(password).not.toBeNull();
  });

  it("404 when accountId belongs to another user", async () => {
    const user = await seedUser();
    const other = await seedUser();
    const otherGoogle = await seedGoogleAccount(other.id, "sub-other");
    await seedCredentialAccount(user.id);
    mockAuth(user.id);

    const res = await unlinkCredential(unlinkCtx({ accountId: otherGoogle.id }));
    expect(res.status).toBe(404);
    const still = await testPrisma.account.findUnique({ where: { id: otherGoogle.id } });
    expect(still).not.toBeNull();
  });
});
