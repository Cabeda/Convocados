import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { authorizeEventMutation } from "~/lib/eventAuthz.server";

/**
 * Unit tests for the event-mutation authorization seam (ADR 0035).
 * Route-level regressions live in authz-regressions.test.ts; this file pins the
 * decisions the seam itself returns so every call site shares one contract.
 */

let ownerId = "";
let adminUserId = "";
let ownerToken = "";
let otherToken = "";
let adminToken = "";

async function seedUserWithToken(prefix: string) {
  const userId = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await prisma.user.create({
    data: { id: userId, name: prefix, email: `${userId}@test.com`, emailVerified: false },
  });
  const clientId = `client-${userId}`;
  await prisma.oauthClient.create({
    data: { id: clientId, clientId, redirectUris: "https://example.com/callback" },
  });
  const token = `tok-${userId}`;
  await prisma.oauthAccessToken.create({
    data: { id: `at-${userId}`, token, clientId, userId, expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { userId, token };
}

async function seedEvent(opts: { ownerId?: string | null; isPublic?: boolean } = {}) {
  return prisma.event.create({
    data: {
      title: "Authz Event",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86_400_000),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
      ownerId: opts.ownerId ?? null,
      isPublic: opts.isPublic ?? false,
    },
  });
}

function request(token?: string) {
  const headers: Record<string, string> = {};
  if (token) headers.authorization = `Bearer ${token}`;
  return new Request("http://localhost/api/test", { method: "POST", headers });
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.oauthAccessToken.deleteMany();
  await prisma.oauthClient.deleteMany();
  await prisma.eventAdmin.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();

  ({ userId: ownerId, token: ownerToken } = await seedUserWithToken("owner"));
  ({ token: otherToken } = await seedUserWithToken("other"));
  ({ userId: adminUserId, token: adminToken } = await seedUserWithToken("admin"));
});

describe("authorizeEventMutation", () => {
  it("allows the owner with role owner", async () => {
    const event = await seedEvent({ ownerId });
    const authz = await authorizeEventMutation(request(ownerToken), event);
    expect(authz).toMatchObject({ allowed: true, role: "owner", isOwner: true, isAdmin: false });
  });

  it("allows an event admin with role admin", async () => {
    const event = await seedEvent({ ownerId });
    await prisma.eventAdmin.create({ data: { eventId: event.id, userId: adminUserId } });
    const authz = await authorizeEventMutation(request(adminToken), event);
    expect(authz).toMatchObject({ allowed: true, role: "admin", isOwner: false, isAdmin: true });
  });

  it("allows anonymous callers on an ownerless UNLISTED event as ownerless-open", async () => {
    const event = await seedEvent({ ownerId: null, isPublic: false });
    const authz = await authorizeEventMutation(request(), event);
    expect(authz).toMatchObject({ allowed: true, role: "ownerless-open" });
  });

  it("forbids a non-owner on an owned event", async () => {
    const event = await seedEvent({ ownerId });
    const authz = await authorizeEventMutation(request(otherToken), event);
    expect(authz).toMatchObject({ allowed: false, role: "forbidden", isOwner: false, isAdmin: false });
  });

  it("forbids anonymous callers on an owned event", async () => {
    const event = await seedEvent({ ownerId });
    const authz = await authorizeEventMutation(request(), event);
    expect(authz.allowed).toBe(false);
    expect(authz.role).toBe("forbidden");
  });

  it("forbids mutations on an ownerless PUBLIC event until adopted", async () => {
    const event = await seedEvent({ ownerId: null, isPublic: true });
    const authz = await authorizeEventMutation(request(), event);
    expect(authz).toMatchObject({ allowed: false, role: "forbidden" });
  });

  it("reuses a pre-fetched session without re-authenticating", async () => {
    const event = await seedEvent({ ownerId });
    const session = {
      user: { id: ownerId, name: "owner", email: "o@test.com" },
    } as unknown as Parameters<typeof authorizeEventMutation>[2];
    const authz = await authorizeEventMutation(request(), event, session);
    expect(authz).toMatchObject({ allowed: true, role: "owner" });
  });
});
