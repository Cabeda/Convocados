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

import { GET as getPendingMerge } from "~/pages/api/me/credentials/pending-merge";
import { POST as runMerge } from "~/pages/api/me/credentials/merge";
import { noteAccountLookup, clearPendingMerges, captureDuring } from "~/lib/mergeCapture.server";

function getCtx() {
  const request = new Request("http://localhost/api/me/credentials/pending-merge", { method: "GET" });
  return { request, params: {} } as any;
}

function postMergeCtx(body?: unknown) {
  const request = new Request("http://localhost/api/me/credentials/merge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params: {} } as any;
}

async function seedUser(email: string, name = "User") {
  const id = `merge-${Math.random().toString(36).slice(2, 8)}`;
  return testPrisma.user.create({
    data: { id, name, email, emailVerified: true },
  });
}

function mockAuth(userId: string) {
  mockGetSession.mockResolvedValue({
    user: { id: userId, name: "Survivor", email: `survivor-${userId}@test.com` },
  });
}

async function seedGoogleAccount(userId: string, sub: string) {
  return testPrisma.account.create({
    data: {
      id: `g-${sub}`,
      accountId: sub,
      providerId: "google",
      issuer: "https://accounts.google.com",
      userId,
    },
  });
}

beforeEach(async () => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue(null);
  clearPendingMerges();
  await testPrisma.session.deleteMany();
  await testPrisma.eventFollow.deleteMany().catch(() => {});
  await testPrisma.notificationPreferences.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.user.deleteMany();
});

describe("pending merge capture", () => {
  it("stores a pending merge when findAccountByKey hits another user during a link", async () => {
    const survivor = await seedUser("survivor@proton.me", "Survivor");
    const absorbed = await seedUser("absorbed@gmail.com", "Absorbed");
    const google = await seedGoogleAccount(absorbed.id, "sub-conflict");

    await captureDuring(survivor.id, async () => {
      noteAccountLookup(
        { providerId: "google", accountId: "sub-conflict", issuer: "https://accounts.google.com" },
        { id: google.id, userId: absorbed.id, providerId: "google", accountId: "sub-conflict", issuer: "https://accounts.google.com" },
      );
    });

    mockAuth(survivor.id);
    const res = await getPendingMerge(getCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.pendingMerge).not.toBeNull();
    expect(body.pendingMerge.absorbedUserId).toBe(absorbed.id);
    expect(body.pendingMerge.absorbedEmail).toBe("absorbed@gmail.com");
    expect(body.pendingMerge.accountId).toBe("sub-conflict");
  });

  it("ignores lookups outside a link capture context", async () => {
    const survivor = await seedUser("s@proton.me");
    const absorbed = await seedUser("a@gmail.com");
    const google = await seedGoogleAccount(absorbed.id, "sub-x");

    noteAccountLookup(
      { providerId: "google", accountId: "sub-x", issuer: "https://accounts.google.com" },
      { id: google.id, userId: absorbed.id, providerId: "google", accountId: "sub-x", issuer: "https://accounts.google.com" },
    );

    mockAuth(survivor.id);
    const res = await getPendingMerge(getCtx());
    const body = await res.json();
    expect(body.pendingMerge).toBeNull();
  });

  it("ignores when account already belongs to the survivor", async () => {
    const survivor = await seedUser("s2@proton.me");
    const google = await seedGoogleAccount(survivor.id, "sub-mine");

    await captureDuring(survivor.id, async () => {
      noteAccountLookup(
        { providerId: "google", accountId: "sub-mine", issuer: "https://accounts.google.com" },
        { id: google.id, userId: survivor.id, providerId: "google", accountId: "sub-mine", issuer: "https://accounts.google.com" },
      );
    });

    mockAuth(survivor.id);
    const res = await getPendingMerge(getCtx());
    const body = await res.json();
    expect(body.pendingMerge).toBeNull();
  });
});

describe("POST /api/me/credentials/merge", () => {
  it("401 when unauthenticated", async () => {
    const res = await runMerge(postMergeCtx({ confirm: true }));
    expect(res.status).toBe(401);
  });

  it("400 when no pending merge", async () => {
    const survivor = await seedUser("nopending@proton.me");
    mockAuth(survivor.id);
    const res = await runMerge(postMergeCtx({ confirm: true }));
    expect(res.status).toBe(400);
  });

  it("400 when confirmation missing", async () => {
    const survivor = await seedUser("noconfirm@proton.me");
    const absorbed = await seedUser("abs2@gmail.com");
    const google = await seedGoogleAccount(absorbed.id, "sub-c2");
    await captureDuring(survivor.id, async () => {
      noteAccountLookup(
        { providerId: "google", accountId: "sub-c2", issuer: "https://accounts.google.com" },
        { id: google.id, userId: absorbed.id, providerId: "google", accountId: "sub-c2", issuer: "https://accounts.google.com" },
      );
    });
    mockAuth(survivor.id);
    const res = await runMerge(postMergeCtx({}));
    expect(res.status).toBe(400);
  });

  it("merges: transfers google credential, deletes absorbed, frees email, hard-logs-out absorbed", async () => {
    const survivor = await seedUser("keep@proton.me", "Keep");
    const absorbed = await seedUser("gone@gmail.com", "Gone");
    const google = await seedGoogleAccount(absorbed.id, "sub-merge");
    // absorbed also has a session (device) that must die
    await testPrisma.session.create({
      data: {
        id: "sess-absorbed",
        token: "tok-absorbed",
        expiresAt: new Date(Date.now() + 3600_000),
        userId: absorbed.id,
      },
    });
    // absorbed owns an event — must transfer to survivor
    await testPrisma.event.create({
      data: {
        id: "ev-merge",
        title: "Absorbed's game",
        dateTime: new Date(),
        ownerId: absorbed.id,
        sport: "padel",
        location: "Court 1",
      },
    });

    await captureDuring(survivor.id, async () => {
      noteAccountLookup(
        { providerId: "google", accountId: "sub-merge", issuer: "https://accounts.google.com" },
        { id: google.id, userId: absorbed.id, providerId: "google", accountId: "sub-merge", issuer: "https://accounts.google.com" },
      );
    });

    mockAuth(survivor.id);
    const res = await runMerge(postMergeCtx({ confirm: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.mergedUserId).toBe(survivor.id);

    // Google credential now on survivor
    const moved = await testPrisma.account.findUnique({ where: { id: google.id } });
    expect(moved?.userId).toBe(survivor.id);

    // Absorbed user gone — email free for re-registration
    const absorbedAfter = await testPrisma.user.findUnique({ where: { id: absorbed.id } });
    expect(absorbedAfter).toBeNull();
    const emailFree = await testPrisma.user.findUnique({ where: { email: "gone@gmail.com" } });
    expect(emailFree).toBeNull();

    // Absorbed sessions hard-logged-out (cascade)
    const sess = await testPrisma.session.findUnique({ where: { id: "sess-absorbed" } });
    expect(sess).toBeNull();

    // Event ownership transferred
    const ev = await testPrisma.event.findUnique({ where: { id: "ev-merge" } });
    expect(ev?.ownerId).toBe(survivor.id);

    // Pending merge cleared
    const again = await getPendingMerge(getCtx());
    expect((await again.json()).pendingMerge).toBeNull();
  });

  it("survivor wins on EventFollow unique collision", async () => {
    const survivor = await seedUser("follow-wins@proton.me");
    const absorbed = await seedUser("follow-loses@gmail.com");
    const google = await seedGoogleAccount(absorbed.id, "sub-follow");
    const event = await testPrisma.event.create({
      data: { id: "ev-follow", title: "Shared", dateTime: new Date(), sport: "padel", location: "Court 2" },
    });
    // Both follow the same event — survivor's row must remain
    await testPrisma.eventFollow.create({
      data: { id: "f-surv", eventId: event.id, userId: survivor.id, muteReminders: true },
    });
    await testPrisma.eventFollow.create({
      data: { id: "f-abs", eventId: event.id, userId: absorbed.id, mutePostGame: true },
    });

    await captureDuring(survivor.id, async () => {
      noteAccountLookup(
        { providerId: "google", accountId: "sub-follow", issuer: "https://accounts.google.com" },
        { id: google.id, userId: absorbed.id, providerId: "google", accountId: "sub-follow", issuer: "https://accounts.google.com" },
      );
    });

    mockAuth(survivor.id);
    const res = await runMerge(postMergeCtx({ confirm: true }));
    expect(res.status).toBe(200);

    const follows = await testPrisma.eventFollow.findMany({ where: { eventId: event.id } });
    expect(follows).toHaveLength(1);
    expect(follows[0].userId).toBe(survivor.id);
    // Survivor's mute flags kept (survivor wins)
    expect(follows[0].muteReminders).toBe(true);
  });

  it("survivor keeps their NotificationPreferences singleton", async () => {
    const survivor = await seedUser("prefs@proton.me");
    const absorbed = await seedUser("prefs-abs@gmail.com");
    const google = await seedGoogleAccount(absorbed.id, "sub-prefs");
    await testPrisma.notificationPreferences.create({
      data: { userId: survivor.id, emailEnabled: false },
    });
    await testPrisma.notificationPreferences.create({
      data: { userId: absorbed.id, emailEnabled: true },
    });

    await captureDuring(survivor.id, async () => {
      noteAccountLookup(
        { providerId: "google", accountId: "sub-prefs", issuer: "https://accounts.google.com" },
        { id: google.id, userId: absorbed.id, providerId: "google", accountId: "sub-prefs", issuer: "https://accounts.google.com" },
      );
    });

    mockAuth(survivor.id);
    const res = await runMerge(postMergeCtx({ confirm: true }));
    expect(res.status).toBe(200);

    const prefs = await testPrisma.notificationPreferences.findUnique({ where: { userId: survivor.id } });
    expect(prefs?.emailEnabled).toBe(false);
    const absorbedPrefs = await testPrisma.notificationPreferences.findUnique({ where: { userId: absorbed.id } });
    expect(absorbedPrefs).toBeNull();
  });
});

// (no extra exports)
