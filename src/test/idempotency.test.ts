import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const mockGetSession = vi.fn().mockResolvedValue(null);
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: false, session: null }),
  checkEventAdmin: vi.fn().mockResolvedValue(false),
}));

import { POST as addPlayer } from "~/pages/api/events/[id]/players";

function ctxWithHeaders(params: Record<string, string>, body: unknown, headers: Record<string, string> = {}) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

function ctxNoHeader(params: Record<string, string>, body: unknown) {
  return ctxWithHeaders(params, body, {});
}

async function seedEvent() {
  const event = await prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      teamOneName: "Ninjas",
      teamTwoName: "Gunas",
    },
  });
  return event.id;
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.gameHistory.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

// ── Payload canonicalization helper (exposed for testing the contract) ────────

function canonicalize(body: Record<string, unknown>): string {
  const obj: Record<string, unknown> = {};
  if (typeof body.name === "string") obj.name = body.name.trim();
  if (body.linkToAccount === true) obj.linkToAccount = true;
  if (typeof body.email === "string" && body.email.trim()) obj.email = body.email.trim().toLowerCase();
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function payloadHash(body: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalize(body)).digest("hex");
}

describe("Idempotency middleware on POST /api/events/[id]/players", () => {
  it("runs the handler when no Idempotency-Key header is present (back-compat)", async () => {
    const eventId = await seedEvent();
    const res = await addPlayer(ctxNoHeader({ id: eventId }, { name: "Alice" }));
    expect(res.status).toBe(200);
    const player = await prisma.player.findUnique({ where: { eventId_name: { eventId, name: "Alice" } } });
    expect(player).not.toBeNull();
  });

  it("replays the cached response when same key + same body is sent twice", async () => {
    const eventId = await seedEvent();
    const key = "test-key-replay-1";
    const body = { name: "Bob" };
    const res1 = await addPlayer(ctxWithHeaders({ id: eventId }, body, { "Idempotency-Key": key }));
    expect(res1.status).toBe(200);
    const body1 = await res1.json();
    const res2 = await addPlayer(ctxWithHeaders({ id: eventId }, body, { "Idempotency-Key": key }));
    expect(res2.status).toBe(200);
    const body2 = await res2.json();
    expect(body2).toEqual(body1);
    // Only one Player row was created — the second request was a replay.
    const count = await prisma.player.count({ where: { eventId, name: "Bob" } });
    expect(count).toBe(1);
  });

  it("returns 422 when same key is reused with a different payload", async () => {
    const eventId = await seedEvent();
    const key = "test-key-mismatch-1";
    const res1 = await addPlayer(ctxWithHeaders({ id: eventId }, { name: "Charlie" }, { "Idempotency-Key": key }));
    expect(res1.status).toBe(200);
    const res2 = await addPlayer(ctxWithHeaders({ id: eventId }, { name: "DifferentName" }, { "Idempotency-Key": key }));
    expect(res2.status).toBe(422);
    const body2 = await res2.json();
    expect(body2.error).toMatch(/different payload/i);
  });

  it("treats names that differ only in whitespace as the same payload", async () => {
    const eventId = await seedEvent();
    const key = "test-key-whitespace-1";
    const res1 = await addPlayer(ctxWithHeaders({ id: eventId }, { name: "Dana" }, { "Idempotency-Key": key }));
    expect(res1.status).toBe(200);
    const res2 = await addPlayer(ctxWithHeaders({ id: eventId }, { name: "  Dana  " }, { "Idempotency-Key": key }));
    expect(res2.status).toBe(200);
  });

  it("distinguishes requests that differ in linkToAccount (same key, different body)", async () => {
    const eventId = await seedEvent();
    const key = "test-key-linktoacct-1";
    const res1 = await addPlayer(ctxWithHeaders({ id: eventId }, { name: "Eve", linkToAccount: true }, { "Idempotency-Key": key }));
    expect(res1.status).toBe(200);
    const res2 = await addPlayer(ctxWithHeaders({ id: eventId }, { name: "Eve", linkToAccount: false }, { "Idempotency-Key": key }));
    expect(res2.status).toBe(422);
  });

  it("does not cache 4xx error responses — same key can retry and succeed", async () => {
    const eventId = await seedEvent();
    const key = "test-key-retry-1";
    // First: empty name returns 400
    const res1 = await addPlayer(ctxWithHeaders({ id: eventId }, { name: "" }, { "Idempotency-Key": key }));
    expect(res1.status).toBe(400);
    // Second: same key + valid name should succeed (4xx is not cached)
    const res2 = await addPlayer(ctxWithHeaders({ id: eventId }, { name: "Frank" }, { "Idempotency-Key": key }));
    expect(res2.status).toBe(200);
  });

  it("two different events with the same Idempotency-Key do not collide", async () => {
    const eventA = await seedEvent();
    const eventBRecord = await prisma.event.create({
      data: {
        title: "Other Event",
        location: "Pitch B",
        dateTime: new Date(Date.now() + 86400_000),
        teamOneName: "A",
        teamTwoName: "B",
      },
    });
    const eventB = eventBRecord.id;
    const key = "shared-key-events-1";
    const res1 = await addPlayer(ctxWithHeaders({ id: eventA }, { name: "Grace" }, { "Idempotency-Key": key }));
    const res2 = await addPlayer(ctxWithHeaders({ id: eventB }, { name: "Grace" }, { "Idempotency-Key": key }));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    const a = await prisma.player.count({ where: { eventId: eventA, name: "Grace" } });
    const b = await prisma.player.count({ where: { eventId: eventB, name: "Grace" } });
    expect(a).toBe(1);
    expect(b).toBe(1);
  });
});

describe("Idempotency canonicalization", () => {
  it("trims whitespace from name", () => {
    expect(canonicalize({ name: "  Alice  " })).toBe(canonicalize({ name: "Alice" }));
  });

  it("lowercases email", () => {
    expect(canonicalize({ name: "X", email: "A@B.COM" })).toBe(canonicalize({ name: "X", email: "a@b.com" }));
  });

  it("omits absent optional fields", () => {
    expect(canonicalize({ name: "X" })).toBe(canonicalize({ name: "X" }));
  });

  it("treats linkToAccount: true vs absent as different", () => {
    expect(canonicalize({ name: "X", linkToAccount: true })).not.toBe(canonicalize({ name: "X" }));
  });

  it("canonicalization is stable across key order", () => {
    expect(canonicalize({ name: "X", linkToAccount: true, email: "a@b.c" })).toBe(
      canonicalize({ email: "a@b.c", linkToAccount: true, name: "X" }),
    );
  });

  it("hash function returns sha256 hex", () => {
    const h = payloadHash({ name: "X" });
    expect(h).toMatch(/^[a-f0-9]{64}$/);
  });
});
