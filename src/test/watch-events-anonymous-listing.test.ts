/**
 * Regression test for #1777: GET /api/watch/events must not leak the roster and
 * score of password-locked Events to an anonymous caller. A cookie-less listing
 * used to return every Event happening today (locked or unlisted included), and
 * ?eventId= served any id without answering locked.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { hashPassword } from "~/lib/eventAccess";

const mockGetSession = vi.fn().mockResolvedValue(null);
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: any[]) => mockGetSession(...args),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: false, isAdmin: false, session: null }),
  checkEventAdmin: vi.fn().mockResolvedValue(false),
}));

const { GET } = await import("~/pages/api/watch/events");

const HOUR = 60 * 60 * 1000;

function ctx(url: string) {
  const request = new Request(url, { method: "GET" });
  return { request, params: {}, url: new URL(request.url) } as any;
}

async function seedUser(id: string) {
  return prisma.user.upsert({
    where: { id },
    create: { id, name: id, email: `${id}@test.com`, emailVerified: true },
    update: {},
  });
}

async function seedEvent(opts: {
  title: string;
  dateTime: Date;
  ownerId: string;
  isPublic?: boolean;
  accessPassword?: string | null;
}) {
  const event = await prisma.event.create({
    data: {
      title: opts.title,
      location: "Pitch",
      dateTime: opts.dateTime,
      ownerId: opts.ownerId,
      isPublic: opts.isPublic ?? true,
      accessPassword: opts.accessPassword ?? null,
    },
  });
  const teamOne = await prisma.teamResult.create({
    data: { name: `${opts.title} One`, eventId: event.id },
  });
  await prisma.teamResult.create({ data: { name: `${opts.title} Two`, eventId: event.id } });
  await prisma.teamMember.create({
    data: { name: `${opts.title} Member`, order: 0, teamResultId: teamOne.id },
  });
  await prisma.gameHistory.create({
    data: {
      eventId: event.id,
      dateTime: opts.dateTime,
      status: "played",
      scoreOne: 3,
      scoreTwo: 1,
      teamOneName: `${opts.title} One`,
      teamTwoName: `${opts.title} Two`,
    },
  });
  return event;
}

beforeEach(async () => {
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.gameHistory.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.teamResult.deleteMany();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  mockGetSession.mockResolvedValue(null);
});

describe("GET /api/watch/events anonymous access (#1777)", () => {
  it("lists only discoverable Events, without the locked Event's roster or score", async () => {
    const owner = await seedUser("watch-anon-owner");
    const kickoff = new Date(Date.now() + HOUR);
    const open = await seedEvent({ title: "Open Game", dateTime: kickoff, ownerId: owner.id });
    const locked = await seedEvent({
      title: "Locked Game",
      dateTime: kickoff,
      ownerId: owner.id,
      accessPassword: hashPassword("secret"),
    });

    const res = await GET(ctx("http://localhost/api/watch/events"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.events.map((e: { id: string }) => e.id);

    expect(ids).toContain(open.id);
    expect(ids).not.toContain(locked.id);
    expect(JSON.stringify(body)).not.toContain("Locked Game Member");

    const openRow = body.events.find((e: { id: string }) => e.id === open.id);
    expect(openRow.latestGame).toBeNull();
  });

  it("keeps the roster score for a signed-in player's own Event", async () => {
    const owner = await seedUser("watch-anon-owner-3");
    const player = await seedUser("watch-signed-in-player");
    const kickoff = new Date(Date.now() + HOUR);
    const mine = await seedEvent({ title: "My Game", dateTime: kickoff, ownerId: owner.id });
    await seedEvent({ title: "Someone Else", dateTime: kickoff, ownerId: owner.id });
    await prisma.player.create({
      data: { name: "Me", eventId: mine.id, userId: player.id },
    });
    mockGetSession.mockResolvedValue({ user: { id: player.id } });

    const res = await GET(ctx("http://localhost/api/watch/events"));
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.events.map((e: { id: string }) => e.id);

    expect(ids).toEqual([mine.id]);
    expect(body.events[0].latestGame).toMatchObject({ scoreOne: 3, scoreTwo: 1 });
  });

  it("answers 403 locked for ?eventId= on a password-locked Event", async () => {
    const owner = await seedUser("watch-anon-owner-2");
    const locked = await seedEvent({
      title: "Locked By Id",
      dateTime: new Date(Date.now() + HOUR),
      ownerId: owner.id,
      accessPassword: hashPassword("secret"),
    });

    const res = await GET(
      ctx(`http://localhost/api/watch/events?eventId=${locked.id}`),
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.locked).toBe(true);
    expect(JSON.stringify(body)).not.toContain("Locked By Id Member");
    expect(body.latestGame).toBeUndefined();
  });
});
