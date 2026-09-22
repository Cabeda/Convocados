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

import { POST as runMerge } from "~/pages/api/me/credentials/merge";
import { mergeUsers } from "~/lib/merge.server";
import {
  noteAccountLookup,
  clearPendingMerges,
  captureDuring,
  getPendingMerge,
  clearPendingMerge,
  installMergeCapture,
  resetMergeCaptureForTests,
} from "~/lib/mergeCapture.server";

function postMergeCtx(body?: unknown) {
  const request = new Request("http://localhost/api/me/credentials/merge", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params: {} } as any;
}

async function seedUser(email: string, name = "User") {
  const id = `mrg-${Math.random().toString(36).slice(2, 8)}`;
  return testPrisma.user.create({ data: { id, name, email, emailVerified: true } });
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
  resetMergeCaptureForTests();
  await testPrisma.session.deleteMany();
  await testPrisma.eventFollow.deleteMany().catch(() => {});
  await testPrisma.seasonMembership.deleteMany().catch(() => {});
  await testPrisma.pushSubscription.deleteMany().catch(() => {});
  await testPrisma.userAppOpen.deleteMany().catch(() => {});
  await testPrisma.appPushToken.deleteMany().catch(() => {});
  await testPrisma.notificationPreferences.deleteMany();
  await testPrisma.player.deleteMany();
  await testPrisma.account.deleteMany();
  await testPrisma.event.deleteMany();
  await testPrisma.user.deleteMany();
});

describe("mergeUsers validation", () => {
  it("rejects merging a user into itself", async () => {
    const user = await seedUser("self@t.com");
    await expect(mergeUsers(testPrisma, user.id, user.id)).rejects.toThrow("Cannot merge a user into itself");
  });

  it("throws when survivor not found", async () => {
    const absorbed = await seedUser("abs@t.com");
    await expect(mergeUsers(testPrisma, "missing-survivor", absorbed.id)).rejects.toThrow("Survivor user not found");
  });

  it("throws when absorbed not found", async () => {
    const survivor = await seedUser("surv@t.com");
    await expect(mergeUsers(testPrisma, survivor.id, "missing-absorbed")).rejects.toThrow("Absorbed user not found");
  });
});

describe("mergeUsers unique-collision conflicts", () => {
  it("discards absorbed SeasonMembership on conflict, survivor wins", async () => {
    const survivor = await seedUser("sm-surv@t.com");
    const absorbed = await seedUser("sm-abs@t.com");
    const season = await testPrisma.season.create({
      data: { id: "s1", eventId: "e1", name: "S", status: "active", createdByUserId: survivor.id, registrationOpensAt: new Date(), registrationClosesAt: new Date() },
    }).catch(() => null);
    // Season may fail if event missing; create event first if needed
    const ev = await testPrisma.event.upsert({
      where: { id: "e1" },
      update: {},
      create: { id: "e1", title: "E", dateTime: new Date(), sport: "padel", location: "X" },
    });
    const s = season ?? await testPrisma.season.create({
      data: { id: "s1", eventId: ev.id, name: "S", status: "active", createdByUserId: survivor.id, registrationOpensAt: new Date(), registrationClosesAt: new Date() },
    });
    const ep = await testPrisma.eventPlayer.create({
      data: { id: "ep1", eventId: ev.id, name: "P", userId: survivor.id },
    });
    const ep2 = await testPrisma.eventPlayer.create({
      data: { id: "ep2", eventId: ev.id, name: "Q", userId: absorbed.id },
    });
    await testPrisma.seasonMembership.create({
      data: { id: "sm-surv", seasonId: s.id, eventPlayerId: ep.id, userId: survivor.id },
    });
    await testPrisma.seasonMembership.create({
      data: { id: "sm-abs", seasonId: s.id, eventPlayerId: ep2.id, userId: absorbed.id },
    });

    const result = await mergeUsers(testPrisma, survivor.id, absorbed.id);
    expect(result.survivorUserId).toBe(survivor.id);
    const remaining = await testPrisma.seasonMembership.findMany({ where: { seasonId: s.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe(survivor.id);
    const absorbedAfter = await testPrisma.user.findUnique({ where: { id: absorbed.id } });
    expect(absorbedAfter).toBeNull();
  });

  it("discards absorbed PushSubscription on endpoint conflict", async () => {
    const survivor = await seedUser("ps-surv@t.com");
    const absorbed = await seedUser("ps-abs@t.com");
    await testPrisma.pushSubscription.create({
      data: { id: "ps-s", userId: survivor.id, endpoint: "https://push.example/1", p256dh: "a", auth: "b" },
    });
    await testPrisma.pushSubscription.create({
      data: { id: "ps-a", userId: absorbed.id, endpoint: "https://push.example/1", p256dh: "c", auth: "d" },
    });

    await mergeUsers(testPrisma, survivor.id, absorbed.id);
    const remaining = await testPrisma.pushSubscription.findMany({ where: { endpoint: "https://push.example/1" } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe(survivor.id);
  });

  it("discards absorbed UserAppOpen on same-day conflict", async () => {
    const survivor = await seedUser("uo-surv@t.com");
    const absorbed = await seedUser("uo-abs@t.com");
    const day = new Date("2026-09-20T00:00:00Z");
    await testPrisma.userAppOpen.create({ data: { id: "uo-s", userId: survivor.id, day } });
    await testPrisma.userAppOpen.create({ data: { id: "uo-a", userId: absorbed.id, day } });

    await mergeUsers(testPrisma, survivor.id, absorbed.id);
    const remaining = await testPrisma.userAppOpen.findMany({ where: { day } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].userId).toBe(survivor.id);
  });

  it("moves absorbed AppPushToken when survivor has no same token", async () => {
    // token is globally @unique, so two rows can never share it; the conflict
    // branch (findFirst token+userId) is therefore unreachable via the same
    // token. Verify the no-conflict transfer path instead.
    const survivor = await seedUser("apt-surv@t.com");
    const absorbed = await seedUser("apt-abs@t.com");
    await testPrisma.appPushToken.create({
      data: { id: "apt-s", userId: survivor.id, token: "token-surv", platform: "android" },
    });
    await testPrisma.appPushToken.create({
      data: { id: "apt-a", userId: absorbed.id, token: "token-abs", platform: "ios" },
    });

    await mergeUsers(testPrisma, survivor.id, absorbed.id);
    const remaining = await testPrisma.appPushToken.findMany({ where: { userId: survivor.id } });
    expect(remaining).toHaveLength(2);
    const moved = await testPrisma.appPushToken.findUnique({ where: { id: "apt-a" } });
    expect(moved?.userId).toBe(survivor.id);
  });

  it("discards absorbed non-google account when survivor has same provider; google always moves", async () => {
    const survivor = await seedUser("acc-surv@t.com");
    const absorbed = await seedUser("acc-abs@t.com");
    // Survivor already has a credential account
    await testPrisma.account.create({
      data: { id: "acc-s-cred", accountId: "s-cred", providerId: "credential", userId: survivor.id, password: "x" },
    });
    // Absorbed has both credential (conflict) and google (unique)
    await testPrisma.account.create({
      data: { id: "acc-a-cred", accountId: "a-cred", providerId: "credential", userId: absorbed.id, password: "y" },
    });
    const google = await seedGoogleAccount(absorbed.id, "sub-acc");

    const result = await mergeUsers(testPrisma, survivor.id, absorbed.id);
    expect(result.transferredAccounts).toBe(1); // google
    expect(result.discardedAccounts).toBe(1); // credential conflict

    const credAbs = await testPrisma.account.findUnique({ where: { id: "acc-a-cred" } });
    expect(credAbs).toBeNull();
    const movedGoogle = await testPrisma.account.findUnique({ where: { id: google.id } });
    expect(movedGoogle?.userId).toBe(survivor.id);
  });

  it("transfers absorbed rows without conflict (no-collision path)", async () => {
    const survivor = await seedUser("nc-surv@t.com");
    const absorbed = await seedUser("nc-abs@t.com");
    // EventFollow with NO conflict — absorbed's row must move to survivor
    const ev = await testPrisma.event.upsert({
      where: { id: "e-nc" },
      update: {},
      create: { id: "e-nc", title: "NoConflict", dateTime: new Date(), sport: "padel", location: "Y" },
    });
    await testPrisma.eventFollow.create({ data: { id: "f-nc", eventId: ev.id, userId: absorbed.id } });
    // PushSubscription with NO conflict
    await testPrisma.pushSubscription.create({
      data: { id: "ps-nc", userId: absorbed.id, endpoint: "https://push.example/unique", p256dh: "a", auth: "b" },
    });

    await mergeUsers(testPrisma, survivor.id, absorbed.id);
    const follow = await testPrisma.eventFollow.findUnique({ where: { id: "f-nc" } });
    expect(follow?.userId).toBe(survivor.id);
    const ps = await testPrisma.pushSubscription.findUnique({ where: { id: "ps-nc" } });
    expect(ps?.userId).toBe(survivor.id);
  });
});

describe("mergeCapture uncovered paths", () => {
  it("getPendingMerge returns null after expiry", () => {
    const survivorId = "expiring-user";
    captureDuring(survivorId, async () => {
      noteAccountLookup(
        { providerId: "google", accountId: "sub-exp", issuer: "https://accounts.google.com" },
        { id: "row", userId: "other", providerId: "google", accountId: "sub-exp", issuer: "https://accounts.google.com" },
      );
    });
    const pending = getPendingMerge(survivorId);
    expect(pending).not.toBeNull();
    // Manually expire
    (pending as any).expiresAt = Date.now() - 1;
    const after = getPendingMerge(survivorId);
    expect(after).toBeNull();
  });

  it("clearPendingMerge removes a single entry", () => {
    const id = "clear-one";
    captureDuring(id, async () => {
      noteAccountLookup(
        { providerId: "google", accountId: "sub-clr", issuer: "https://accounts.google.com" },
        { id: "row", userId: "other", providerId: "google", accountId: "sub-clr", issuer: "https://accounts.google.com" },
      );
    });
    expect(getPendingMerge(id)).not.toBeNull();
    clearPendingMerge(id);
    expect(getPendingMerge(id)).toBeNull();
  });

  it("installMergeCapture wraps findAccountByKey and notes lookups", async () => {
    const noted: unknown[] = [];
    let capturedKey: unknown = null;
    const fakeAuth = {
      $context: Promise.resolve({
        internalAdapter: {
          findAccountByKey: async (key: unknown) => {
            capturedKey = key;
            return { id: "r", userId: "absorbed-x", providerId: "google", accountId: "sub-inst", issuer: "https://accounts.google.com" };
          },
        },
      }),
    };
    await installMergeCapture(fakeAuth as any);
    const ctx = (await fakeAuth.$context) as any;
    // The wrapper should exist (function or patched)
    expect(typeof ctx.internalAdapter.findAccountByKey).toBe("function");
    // Running inside a capture context should note the account
    await captureDuring("survivor-inst", async () => {
      const result = await ctx.internalAdapter.findAccountByKey({
        providerId: "google",
        accountId: "sub-inst",
        issuer: "https://accounts.google.com",
      });
      noted.push(result);
    });
    expect(noted).toHaveLength(1);
    const pending = getPendingMerge("survivor-inst");
    expect(pending).not.toBeNull();
    expect(pending?.absorbedUserId).toBe("absorbed-x");
    expect(capturedKey).toMatchObject({ accountId: "sub-inst" });
  });

  it("installMergeCapture catches errors and allows re-install", async () => {
    // auth without $context resolving to internalAdapter → throws inside try
    const badAuth = { $context: Promise.resolve({}) };
    await installMergeCapture(badAuth as any); // should not throw
    // Second call returns immediately (installed flag was reset by failure)
    await installMergeCapture(badAuth as any);
  });
});

describe("POST /api/me/credentials/merge — absorbed with rows that conflict", () => {
  it("401 when unauthenticated", async () => {
    const res = await runMerge(postMergeCtx({ confirm: true }));
    expect(res.status).toBe(401);
  });

  it("merge succeeds and clears pending", async () => {
    const survivor = await seedUser("ok-surv@t.com", "OK");
    const absorbed = await seedUser("ok-abs@t.com", "AB");
    const google = await seedGoogleAccount(absorbed.id, "sub-ok");
    await captureDuring(survivor.id, async () => {
      noteAccountLookup(
        { providerId: "google", accountId: "sub-ok", issuer: "https://accounts.google.com" },
        { id: google.id, userId: absorbed.id, providerId: "google", accountId: "sub-ok", issuer: "https://accounts.google.com" },
      );
    });
    mockAuth(survivor.id);
    const res = await runMerge(postMergeCtx({ confirm: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(getPendingMerge(survivor.id)).toBeNull();
  });
});
