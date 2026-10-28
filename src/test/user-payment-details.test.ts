import { describe, it, expect, beforeEach, vi } from "vitest";
import { PrismaClient } from "@prisma/client";

const testPrisma = new PrismaClient();

const mockGetSession = vi.fn();
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
}));

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("~/lib/db.server", async () => {
  const { PrismaClient: PC } = await import("~/lib/prisma-client");
  const p = new PC();
  return { prisma: p };
});

import { GET, PUT } from "~/pages/api/me/payment-details";

// ── Helpers ──────────────────────────────────────────────────────────────────

function getCtx() {
  const request = new Request("http://localhost/api/me/payment-details", { method: "GET" });
  return { request, params: {} } as any;
}

function putCtx(body: unknown) {
  const request = new Request("http://localhost/api/me/payment-details", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: {} } as any;
}

async function seedUser() {
  const id = `user-pd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await testPrisma.user.create({
    data: { id, name: "Ana", email: `${id}@example.com` },
  });
  return id;
}

function session(userId: string) {
  return { user: { id: userId } };
}

beforeEach(async () => {
  await testPrisma.user.deleteMany({ where: { id: { startsWith: "user-pd-" } } });
  mockGetSession.mockReset();
});

// ── GET ──────────────────────────────────────────────────────────────────────

describe("GET /api/me/payment-details", () => {
  it("returns nothing shared and no details for a new account", async () => {
    const userId = await seedUser();
    mockGetSession.mockResolvedValue(session(userId));

    const res = await GET(getCtx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      phone: null,
      paymentDetails: [],
      sharePaymentDetails: false,
    });
  });

  it("rejects an unauthenticated caller", async () => {
    mockGetSession.mockResolvedValue(null);
    const res = await GET(getCtx());
    expect(res.status).toBe(401);
  });
});

// ── PUT ──────────────────────────────────────────────────────────────────────

describe("PUT /api/me/payment-details", () => {
  it("saves the phone and details, and normalises a Revolut tag", async () => {
    const userId = await seedUser();
    mockGetSession.mockResolvedValue(session(userId));

    const res = await PUT(
      putCtx({
        phone: "+351 912 345 678",
        paymentDetails: [{ type: "revolut_tag", value: "@ana" }],
      }),
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.phone).toBe("+351912345678");
    expect(body.paymentDetails).toEqual([{ type: "revolut_tag", value: "ana" }]);

    const stored = await testPrisma.user.findUnique({ where: { id: userId } });
    expect(JSON.parse(stored!.paymentDetails!)).toEqual([{ type: "revolut_tag", value: "ana" }]);
  });

  it("refuses an invalid method and leaves the stored details untouched", async () => {
    const userId = await seedUser();
    mockGetSession.mockResolvedValue(session(userId));

    await PUT(putCtx({ paymentDetails: [{ type: "revolut_tag", value: "ana" }] }));
    const res = await PUT(putCtx({ paymentDetails: [{ type: "revolut_link", value: "https://evil.example/x" }] }));

    expect(res.status).toBe(400);
    const stored = await testPrisma.user.findUnique({ where: { id: userId } });
    expect(JSON.parse(stored!.paymentDetails!)).toEqual([{ type: "revolut_tag", value: "ana" }]);
  });

  it("stores consent separately from the details", async () => {
    const userId = await seedUser();
    mockGetSession.mockResolvedValue(session(userId));

    await PUT(putCtx({ paymentDetails: [{ type: "mbway", value: "912345678" }], sharePaymentDetails: true }));

    const stored = await testPrisma.user.findUnique({ where: { id: userId } });
    expect(stored!.sharePaymentDetails).toBe(true);
  });

  it("rejects more than ten payment details", async () => {
    const userId = await seedUser();
    mockGetSession.mockResolvedValue(session(userId));

    const eleven = Array.from({ length: 11 }, () => ({ type: "cash", value: "cash" }));
    const res = await PUT(putCtx({ paymentDetails: eleven }));

    expect(res.status).toBe(400);
  });
});
