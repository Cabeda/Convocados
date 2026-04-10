import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

import { PUT as updateDateTime } from "~/pages/api/events/[id]/datetime";
import { POST as createEvent } from "~/pages/api/events/index";

function putCtx(params: Record<string, string>, body: unknown, userId?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const request = new Request("http://localhost/api/test", {
    method: "PUT",
    headers,
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

function postCtx(body: unknown) {
  const request = new Request("http://localhost/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: {} } as any;
}

async function seedEvent(overrides: Partial<{ timezone: string; ownerId: string | null }> = {}) {
  return prisma.event.create({
    data: {
      title: "Test Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      timezone: overrides.timezone ?? "UTC",
      ownerId: overrides.ownerId ?? null,
    },
  });
}

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.eventLog.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
});

// ── POST /api/events — timezone ───────────────────────────────────────────────

describe("POST /api/events — timezone", () => {
  const future = new Date(Date.now() + 86400_000).toISOString();

  it("stores the provided timezone on creation", async () => {
    const res = await createEvent(postCtx({
      title: "TZ Test",
      dateTime: future,
      timezone: "Europe/Lisbon",
    }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.timezone).toBe("Europe/Lisbon");
  });

  it("defaults to UTC when no timezone provided", async () => {
    const res = await createEvent(postCtx({ title: "No TZ", dateTime: future }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.timezone).toBe("UTC");
  });

  it("falls back to UTC for an invalid timezone", async () => {
    const res = await createEvent(postCtx({
      title: "Bad TZ",
      dateTime: future,
      timezone: "Not/ATimezone",
    }));
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const event = await prisma.event.findUnique({ where: { id } });
    expect(event?.timezone).toBe("UTC");
  });
});

// ── PUT /api/events/[id]/datetime ─────────────────────────────────────────────

describe("PUT /api/events/[id]/datetime", () => {
  it("updates dateTime on an ownerless event", async () => {
    const event = await seedEvent();
    const newDate = new Date(Date.now() + 2 * 86400_000).toISOString();
    const res = await updateDateTime(putCtx({ id: event.id }, { dateTime: newDate }));
    expect(res.status).toBe(200);
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.dateTime.toISOString()).toBe(new Date(newDate).toISOString());
  });

  it("updates timezone on an ownerless event", async () => {
    const event = await seedEvent();
    const res = await updateDateTime(putCtx({ id: event.id }, { timezone: "Europe/Madrid" }));
    expect(res.status).toBe(200);
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.timezone).toBe("Europe/Madrid");
  });

  it("updates both dateTime and timezone together", async () => {
    const event = await seedEvent();
    const newDate = new Date(Date.now() + 3 * 86400_000).toISOString();
    const res = await updateDateTime(putCtx({ id: event.id }, { dateTime: newDate, timezone: "America/New_York" }));
    expect(res.status).toBe(200);
    const updated = await prisma.event.findUnique({ where: { id: event.id } });
    expect(updated?.timezone).toBe("America/New_York");
    expect(updated?.dateTime.toISOString()).toBe(new Date(newDate).toISOString());
  });

  it("returns 400 for invalid dateTime", async () => {
    const event = await seedEvent();
    const res = await updateDateTime(putCtx({ id: event.id }, { dateTime: "not-a-date" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid date/i);
  });

  it("returns 400 for invalid timezone", async () => {
    const event = await seedEvent();
    const res = await updateDateTime(putCtx({ id: event.id }, { timezone: "Fake/Zone" }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toMatch(/invalid timezone/i);
  });

  it("returns 400 when nothing to update", async () => {
    const event = await seedEvent();
    const res = await updateDateTime(putCtx({ id: event.id }, {}));
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown event", async () => {
    const res = await updateDateTime(putCtx({ id: "nonexistent" }, { timezone: "UTC" }));
    expect(res.status).toBe(404);
  });

  it("returns 403 when non-owner tries to update an owned event", async () => {
    const owner = await prisma.user.create({
      data: { id: "owner-1", name: "Owner", email: "owner@test.com", emailVerified: false },
    });
    const event = await seedEvent({ ownerId: owner.id });
    // No session cookie → treated as anonymous
    const res = await updateDateTime(putCtx({ id: event.id }, { timezone: "Europe/Paris" }));
    expect(res.status).toBe(403);
  });

  it("creates an event log entry when dateTime is updated", async () => {
    const event = await seedEvent();
    const newDate = new Date(Date.now() + 4 * 86400_000).toISOString();
    await updateDateTime(putCtx({ id: event.id }, { dateTime: newDate }));
    const logs = await prisma.eventLog.findMany({ where: { eventId: event.id } });
    expect(logs.length).toBeGreaterThan(0);
    expect(logs[0].action).toBe("event_updated");
  });
});
