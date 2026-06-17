import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { POST } from "~/pages/api/events/[id]/players";
import { getSession } from "~/lib/auth.helpers.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { normalizeForMatch } from "~/lib/stringMatch";

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

const mockGetSession = vi.mocked(getSession);

function ctx(eventId: string, body: any, session: { user: { id: string; name: string } } | null) {
  mockGetSession.mockResolvedValue(session as any);
  return {
    params: { id: eventId },
    request: new Request(`http://localhost/api/events/${eventId}/players`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-client-id": "test-client" },
      body: JSON.stringify(body),
    }),
  } as any;
}

async function seedEvent() {
  return prisma.event.create({
    data: {
      title: "Ninjas da Areosa",
      location: "Pitch",
      dateTime: new Date(Date.now() + 86400_000),
      maxPlayers: 10,
    },
  });
}

beforeEach(async () => {
  await prisma.eventLog.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  resetRateLimitStore();
  resetApiRateLimitStore();
  vi.clearAllMocks();
});

describe("POST /api/events/[id]/players — auto-link on name match", () => {
  it("auto-links a new player to a matching user account (owner typing on behalf)", async () => {
    const owner = await prisma.user.create({
      data: { id: "u-owner", name: "José", email: "jose@t.com", emailVerified: true },
    });
    const goncalo = await prisma.user.create({
      data: { id: "u-goncalo", name: "Gonçalo", email: "g@t.com", emailVerified: true },
    });
    const event = await seedEvent();

    // Owner is logged in but adds "Gonçalo" — should auto-link to the Gonçalo account
    const res = await POST(ctx(event.id, { name: "Gonçalo" }, { user: { id: owner.id, name: "José" } }));
    expect(res.status).toBe(200);

    const player = await prisma.player.findFirst({ where: { eventId: event.id, name: "Gonçalo" } });
    expect(player).not.toBeNull();
    expect(player!.userId).toBe(goncalo.id);
  });

  it("auto-link is accent-insensitive (typed 'Goncalo' matches user 'Gonçalo')", async () => {
    const goncalo = await prisma.user.create({
      data: { id: "u-goncalo", name: "Gonçalo", email: "g@t.com", emailVerified: true },
    });
    const event = await seedEvent();

    // No session at all — anonymous owner typing on behalf
    const res = await POST(ctx(event.id, { name: "Goncalo" }, null));
    expect(res.status).toBe(200);

    const player = await prisma.player.findFirst({ where: { eventId: event.id, name: "Goncalo" } });
    expect(player).not.toBeNull();
    expect(player!.userId).toBe(goncalo.id);
  });

  it("auto-link is case-insensitive", async () => {
    const goncalo = await prisma.user.create({
      data: { id: "u-goncalo", name: "Gonçalo", email: "g@t.com", emailVerified: true },
    });
    const event = await seedEvent();

    const res = await POST(ctx(event.id, { name: "GONÇALO" }, null));
    expect(res.status).toBe(200);

    const player = await prisma.player.findFirst({ where: { eventId: event.id } });
    expect(player!.userId).toBe(goncalo.id);
  });

  it("stays anonymous when no user matches the name", async () => {
    await prisma.user.create({
      data: { id: "u-1", name: "José", email: "j@t.com", emailVerified: true },
    });
    const event = await seedEvent();

    const res = await POST(ctx(event.id, { name: "Stranger" }, null));
    expect(res.status).toBe(200);

    const player = await prisma.player.findFirst({ where: { eventId: event.id } });
    expect(player!.userId).toBeNull();
  });

  it("stays anonymous when multiple users share the name (ambiguous)", async () => {
    await prisma.user.create({
      data: { id: "u-1", name: "Gonçalo", email: "g1@t.com", emailVerified: true },
    });
    await prisma.user.create({
      data: { id: "u-2", name: "Gonçalo", email: "g2@t.com", emailVerified: true },
    });
    const event = await seedEvent();

    const res = await POST(ctx(event.id, { name: "Gonçalo" }, null));
    expect(res.status).toBe(200);

    const player = await prisma.player.findFirst({ where: { eventId: event.id } });
    expect(player!.userId).toBeNull();
  });

  it("does not auto-link if the matching user already has a player in this event", async () => {
    const goncalo = await prisma.user.create({
      data: { id: "u-goncalo", name: "Gonçalo", email: "g@t.com", emailVerified: true },
    });
    const event = await seedEvent();

    // Pre-existing linked player for the same user
    await prisma.player.create({ data: { name: "Gonçalo", eventId: event.id, userId: goncalo.id, order: 0 } });

    const res = await POST(ctx(event.id, { name: "Gonçalo", linkToAccount: false }, null));
    // Should still 409 because a player with that name already exists in the event
    expect(res.status).toBe(409);
  });

  it("preserves the explicit linkToAccount behaviour for the session user", async () => {
    const goncalo = await prisma.user.create({
      data: { id: "u-goncalo", name: "Gonçalo", email: "g@t.com", emailVerified: true },
    });
    const event = await seedEvent();

    // No user account named "Quickjoin" — falls back to session-link
    const res = await POST(ctx(event.id, { name: "Quickjoin", linkToAccount: true }, { user: { id: goncalo.id, name: "Gonçalo" } }));
    expect(res.status).toBe(200);

    const player = await prisma.player.findFirst({ where: { eventId: event.id, name: "Quickjoin" } });
    expect(player!.userId).toBe(goncalo.id);
  });

  it("uses normalizeForMatch semantics — exact comparison after NFD strip", () => {
    // Sanity check: the matcher used by the endpoint behaves the same as the helper
    expect(normalizeForMatch("Gonçalo")).toBe(normalizeForMatch("GONCALO"));
    expect(normalizeForMatch("Gonçalo")).toBe(normalizeForMatch("goncalo"));
    expect(normalizeForMatch("Gonçalo")).not.toBe(normalizeForMatch("João"));
  });

  it("logs actor as null (anonymous) when no session is present (#456)", async () => {
    const event = await seedEvent();
    const res = await POST(ctx(event.id, { name: "Stranger" }, null));
    expect(res.status).toBe(200);

    // logEvent is fire-and-forget in the handler — wait for the row.
    let log: Awaited<ReturnType<typeof prisma.eventLog.findFirst>> = null;
    for (let i = 0; i < 20 && !log; i++) {
      log = await prisma.eventLog.findFirst({ where: { eventId: event.id, action: "player_added" } });
      if (!log) await new Promise((r) => setTimeout(r, 25));
    }
    expect(log).not.toBeNull();
    // #456: actor must NOT be the added player's name; it should be null so
    // EventLogPage renders the i18n "logAnonymous" fallback.
    expect(log!.actor).toBeNull();
    expect(log!.actorId).toBeNull();
    expect(JSON.parse(log!.details)).toEqual({ playerName: "Stranger" });
  });
});
