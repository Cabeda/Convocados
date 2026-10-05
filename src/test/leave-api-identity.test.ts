import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server");
vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("~/lib/notificationQueue.server", () => ({
  enqueueNotification: vi.fn().mockResolvedValue(undefined),
  drainNotificationQueue: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("~/lib/webhook.server", () => ({
  fireWebhooks: vi.fn().mockResolvedValue(undefined),
}));

import { getSession } from "~/lib/auth.helpers.server";
import { POST } from "~/pages/api/events/[id]/leave";

function ctx(eventId: string) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", host: "convocados.cabeda.dev" },
  });
  return { request, params: { id: eventId } } as any;
}

/**
 * Repro of the production report: the event GET (ADR 0016) renders the roster
 * from GameParticipant + EventPlayer, so the page shows the user as joined and
 * offers a Leave button. The leave route instead resolved identity from the
 * legacy `Player` table with `archivedAt: null`. When the user's only Player row
 * is archived but their EventPlayer/GameParticipant is live, the page says
 * "You joined as <name>" and the leave call answers 404 "You are not a player
 * in this event."
 */
describe("POST /api/events/[id]/leave — EventPlayer-native identity (ADR 0016/0026)", () => {
  beforeEach(async () => {
    await resetApiRateLimitStore();
    await prisma.rsvp.deleteMany();
    await prisma.eventFollow.deleteMany();
    await prisma.gameParticipant.deleteMany();
    await prisma.eventPlayer.deleteMany();
    await prisma.player.deleteMany();
    await prisma.event.deleteMany();
    await prisma.user.deleteMany();
    vi.restoreAllMocks();
  });

  async function seedEventPlayerNativeRoster(opts: { legacyName: string; legacyPlayerArchived: boolean }) {
    const user = await prisma.user.create({
      data: { id: "u1", name: "José Cabeda", email: "jose@test.com", createdAt: new Date(), updatedAt: new Date() },
    });
    const event = await prisma.event.create({
      data: { title: "T", location: "F", dateTime: new Date(Date.now() + 86400_000), teamOneName: "A", teamTwoName: "B" },
    });
    const game = await prisma.game.create({ data: { eventId: event.id, dateTime: event.dateTime } });
    await prisma.event.update({ where: { id: event.id }, data: { currentGameId: game.id } });

    // The authoritative roster row: live EventPlayer + active GameParticipant.
    const ep = await prisma.eventPlayer.create({
      data: { eventId: event.id, name: "José Cabeda", userId: user.id },
    });
    await prisma.gameParticipant.create({
      data: { gameId: game.id, eventPlayerId: ep.id, order: 0, status: "active" },
    });

    await prisma.player.create({
      data: {
        eventId: event.id,
        name: opts.legacyName,
        userId: user.id,
        order: 0,
        ...(opts.legacyPlayerArchived ? { archivedAt: new Date() } : {}),
      },
    });

    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id, email: user.email } } as any);
    return { user, event, game, ep };
  }

  // The production report: the EventPlayer is live on the current game while the
  // only `Player` row is archived AND carries a different display name, so no
  // non-archived Player row matches the caller's userId at all.
  it("leaves via the live EventPlayer identity when the legacy Player row is archived", async () => {
    const { user, event, game, ep } = await seedEventPlayerNativeRoster({
      legacyName: "Cabeda",
      legacyPlayerArchived: true,
    });

    const res = await POST(ctx(event.id));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);

    // The roster the user actually sees must lose them.
    const gp = await prisma.gameParticipant.findFirst({ where: { gameId: game.id, eventPlayerId: ep.id } });
    expect(gp?.archivedAt).not.toBeNull();

    // And the leave must be recorded against the EventPlayer identity, which is
    // where the Declined roster reads from.
    const rsvp = await prisma.rsvp.findUnique({
      where: { eventPlayerId_gameId: { eventPlayerId: ep.id, gameId: game.id } },
    });
    expect(rsvp?.status).toBe("no");

    // Self-removal auto-unfollows the account.
    const follow = await prisma.eventFollow.findFirst({ where: { eventId: event.id, userId: user.id } });
    expect(follow).toBeNull();
  });

  it("still archives the legacy Player row when it is live and name-matched", async () => {
    const { event } = await seedEventPlayerNativeRoster({
      legacyName: "José Cabeda",
      legacyPlayerArchived: false,
    });

    const res = await POST(ctx(event.id));

    expect(res.status).toBe(200);
    const player = await prisma.player.findFirst({ where: { eventId: event.id } });
    expect(player?.archivedAt).not.toBeNull();
  });

  it("does not archive a stale Player row that carries a different name", async () => {
    const { event } = await seedEventPlayerNativeRoster({
      legacyName: "Someone Else",
      legacyPlayerArchived: false,
    });

    const res = await POST(ctx(event.id));

    expect(res.status).toBe(200);
    const player = await prisma.player.findFirst({ where: { eventId: event.id } });
    expect(player?.archivedAt).toBeNull();
  });

  it("returns 404 when the caller has no roster identity at all", async () => {
    const user = await prisma.user.create({
      data: { id: "u1", name: "Stranger", email: "s@test.com", createdAt: new Date(), updatedAt: new Date() },
    });
    const event = await prisma.event.create({
      data: { title: "T", location: "F", dateTime: new Date(Date.now() + 86400_000), teamOneName: "A", teamTwoName: "B" },
    });
    vi.mocked(getSession).mockResolvedValue({ user: { id: user.id, email: user.email } } as any);

    const res = await POST(ctx(event.id));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not a player");
  });
});