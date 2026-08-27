/**
 * POST /api/watch/events must allow starting a game history WITHOUT teams
 * assigned, so a solo organizer can use the watch to track scores/entries
 * before teams are set (they may add players later).
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

const mockGetSession = vi.fn().mockResolvedValue(null);
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: false, session: null }),
}));
vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { POST as watchEventPost } from "~/pages/api/watch/events";

function req(params: Record<string, string>, body?: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

beforeEach(async () => {
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.gameHistory.deleteMany();
  await prisma.game.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  mockGetSession.mockResolvedValue(null);
});

describe("POST /api/watch/events with no teams", () => {
  it("creates a history record (200, created=true) even when the event has no teams", async () => {
    const owner = await prisma.user.create({
      data: { id: "watch-owner", name: "Owner", email: "owner@t.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: {
        title: "Solo Sessions",
        location: "Court",
        dateTime: new Date(Date.now() + 3600_000),
        ownerId: owner.id,
      },
    });
    // Owner is the player (no teamResults, no GameParticipant needed for isPlayer
    // since checkOwnership returns owner access).
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });

    const res = await watchEventPost(req({}, { eventId: event.id }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toBe(true);

    const history = await prisma.gameHistory.findFirstOrThrow({ where: { eventId: event.id } });
    expect(history.teamOneName).toBe("Ninjas"); // falls back to event default
    expect(history.teamsSnapshot).toBeNull(); // no teams — null, not "[]" (avoids ELO guards)
  });

  it("returns the existing history when called twice (idempotent)", async () => {
    const owner = await prisma.user.create({
      data: { id: "watch-owner-2", name: "Owner", email: "o2@t.com", emailVerified: true },
    });
    const event = await prisma.event.create({
      data: { title: "E", location: "C", dateTime: new Date(), ownerId: owner.id },
    });
    mockGetSession.mockResolvedValue({ user: { id: owner.id } });

    const first = await watchEventPost(req({}, { eventId: event.id }));
    expect(first.status).toBe(200);
    const second = await watchEventPost(req({}, { eventId: event.id }));
    const body = await second.json();
    expect(body.created).toBe(false);
  });
});
