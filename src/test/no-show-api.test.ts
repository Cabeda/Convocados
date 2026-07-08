import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server");
vi.mock("~/lib/push.server");
vi.mock("~/lib/notificationPrefs.server");

import { checkOwnership } from "~/lib/auth.helpers.server";
import { sendPushToUser } from "~/lib/push.server";
import { getNotificationPrefs } from "~/lib/notificationPrefs.server";
import { POST } from "~/pages/api/events/[id]/no-show";

function ctx(eventId: string, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params: { id: eventId } } as any;
}

let event: any;
let user: any;
let player: any;
let game: any;
let participant: any;

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.gameParticipant.deleteMany();
  await prisma.game.deleteMany();
  await prisma.priorityEnrollment.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  vi.restoreAllMocks();

  vi.mocked(checkOwnership).mockResolvedValue({ isOwner: true, isAdmin: false, session: null });
  vi.mocked(getNotificationPrefs).mockResolvedValue({ pushEnabled: true, emailEnabled: false } as any);
  vi.mocked(sendPushToUser).mockResolvedValue(undefined as any);

  user = await prisma.user.create({
    data: { id: "u1", name: "Player One", email: "p1@test.com", createdAt: new Date(), updatedAt: new Date() },
  });
  event = await prisma.event.create({
    data: { title: "Test Game", location: "Field", dateTime: new Date(), ownerId: user.id, teamOneName: "A", teamTwoName: "B" },
  });
  player = await prisma.eventPlayer.create({
    data: { eventId: event.id, name: "Player One", userId: user.id },
  });
  game = await prisma.game.create({
    data: { eventId: event.id, dateTime: new Date(), status: "played" },
  });
  participant = await prisma.gameParticipant.create({
    data: { gameId: game.id, eventPlayerId: player.id },
  });
});

describe("POST /api/events/[id]/no-show", () => {
  it("returns 404 for non-existent event", async () => {
    const res = await POST(ctx("non-existent", { gameId: game.id, eventPlayerId: player.id, noShow: true }));
    expect(res.status).toBe(404);
  });

  it("returns 403 for non-owner/admin", async () => {
    vi.mocked(checkOwnership).mockResolvedValue({ isOwner: false, isAdmin: false, session: null });
    const res = await POST(ctx(event.id, { gameId: game.id, eventPlayerId: player.id, noShow: true }));
    expect(res.status).toBe(403);
  });

  it("returns 400 for missing fields", async () => {
    const res = await POST(ctx(event.id, { gameId: game.id }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("required");
  });

  it("returns 400 when noShow is not boolean", async () => {
    const res = await POST(ctx(event.id, { gameId: game.id, eventPlayerId: player.id, noShow: "yes" }));
    expect(res.status).toBe(400);
  });

  it("returns 404 for non-existent participant", async () => {
    const res = await POST(ctx(event.id, { gameId: game.id, eventPlayerId: "fake-player", noShow: true }));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("Participant not found");
  });

  it("marks player as no-show", async () => {
    const res = await POST(ctx(event.id, { gameId: game.id, eventPlayerId: player.id, noShow: true }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.noShow).toBe(true);

    const updated = await prisma.gameParticipant.findUnique({ where: { id: participant.id } });
    expect(updated!.noShow).toBe(true);
  });

  it("sends push notification on no-show", async () => {
    const res = await POST(ctx(event.id, { gameId: game.id, eventPlayerId: player.id, noShow: true }));
    expect(res.status).toBe(200);
    expect(sendPushToUser).toHaveBeenCalledWith(user.id, event.title, expect.stringContaining("missed"), expect.any(String));
  });

  it("increments noShowStreak on PriorityEnrollment", async () => {
    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: user.id, noShowStreak: 0 },
    });

    await POST(ctx(event.id, { gameId: game.id, eventPlayerId: player.id, noShow: true }));

    const enrollment = await prisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: user.id } },
    });
    expect(enrollment!.noShowStreak).toBe(1);
  });

  it("does not send push when user has push disabled", async () => {
    vi.mocked(getNotificationPrefs).mockResolvedValue({ pushEnabled: false, emailEnabled: false } as any);
    vi.mocked(sendPushToUser).mockClear();
    await POST(ctx(event.id, { gameId: game.id, eventPlayerId: player.id, noShow: true }));
    expect(sendPushToUser).not.toHaveBeenCalled();
  });

  it("unmarking no-show decrements streak", async () => {
    await prisma.gameParticipant.update({ where: { id: participant.id }, data: { noShow: true } });
    await prisma.priorityEnrollment.create({
      data: { eventId: event.id, userId: user.id, noShowStreak: 2 },
    });

    const res = await POST(ctx(event.id, { gameId: game.id, eventPlayerId: player.id, noShow: false }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.noShow).toBe(false);

    const enrollment = await prisma.priorityEnrollment.findUnique({
      where: { eventId_userId: { eventId: event.id, userId: user.id } },
    });
    expect(enrollment!.noShowStreak).toBe(1);
  });

  it("does not notify on unmark (noShow=false)", async () => {
    await prisma.gameParticipant.update({ where: { id: participant.id }, data: { noShow: true } });
    vi.mocked(sendPushToUser).mockClear();
    await POST(ctx(event.id, { gameId: game.id, eventPlayerId: player.id, noShow: false }));
    expect(sendPushToUser).not.toHaveBeenCalled();
  });
});
