import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma, Prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { hashPassword } from "~/lib/eventAccess";
import { GET as listSeasons, POST as createSeason } from "~/pages/api/events/[id]/seasons/index";
import { GET as getSeason, PATCH as patchSeason } from "~/pages/api/events/[id]/seasons/[seasonId]/index";
import {
  POST as joinSeason,
  DELETE as withdrawSeason,
} from "~/pages/api/events/[id]/seasons/[seasonId]/membership";

const mockGetSession = vi.fn();
const mockCheckEventAdmin = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  checkEventAdmin: (...args: unknown[]) => mockCheckEventAdmin(...args),
}));

function context(params: Record<string, string>, method: string, body?: unknown, query = "") {
  const request = new Request(`http://localhost/api/events/test${query}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, params, url: new URL(request.url) } as unknown as APIContext;
}

function rawContext(params: Record<string, string>, method: string, rawBody: string) {
  const request = new Request("http://localhost/api/events/test", {
    method,
    headers: { "content-type": "application/json" },
    body: rawBody,
  });
  return { request, params, url: new URL(request.url) } as unknown as APIContext;
}

async function seedEvent(overrides: { ownerId?: string; password?: boolean } = {}) {
  for (const id of ["owner-1", "other-user", "user-1", "admin-1"]) {
    await prisma.user.upsert({
      where: { id },
      update: {},
      create: { id, name: id, email: `${id}@example.test` },
    });
  }
  return prisma.event.create({
    data: {
      title: "Edge Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: overrides.ownerId ?? "owner-1",
      accessPassword: overrides.password ? hashPassword("secret") : null,
      eloEnabled: true,
      balanced: true,
    },
  });
}

function seasonWindow(opens = Date.now() - 60_000, closes = Date.now() + 14 * 86400_000) {
  return { registrationOpensAt: new Date(opens).toISOString(), registrationClosesAt: new Date(closes).toISOString() };
}

async function seedSeason(eventId: string, overrides: { status?: string; opens?: Date; closes?: Date } = {}) {
  return prisma.season.create({
    data: {
      eventId,
      name: "Edge Season",
      status: overrides.status ?? "registration",
      registrationOpensAt: overrides.opens ?? new Date(Date.now() - 60_000),
      registrationClosesAt: overrides.closes ?? new Date(Date.now() + 14 * 86400_000),
    },
  });
}

/** Consumes the `write` rate limit bucket (30/min) for the shared test IP. */
async function exhaustWriteLimit(handler: (ctx: APIContext) => Response | Promise<Response>) {
  for (let index = 0; index <= 30; index += 1) {
    await handler(context({ id: "unknown-event" }, "POST", { name: "x" }));
  }
  return handler(context({ id: "unknown-event" }, "POST", { name: "x" }));
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  mockCheckEventAdmin.mockResolvedValue(false);
  await resetApiRateLimitStore();
  await prisma.crewProposalInvite.deleteMany();
  await prisma.crewProposalMember.deleteMany();
  await prisma.crewProposal.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.playerRating.deleteMany();
  await prisma.season.deleteMany();
  await prisma.eventInvite.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Seasons list and create edge cases", () => {
  it("returns a locked payload for a password-protected Event", async () => {
    const event = await seedEvent({ password: true });
    mockGetSession.mockResolvedValue(null);

    const response = await listSeasons(context({ id: event.id }, "GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ locked: true, id: event.id, hasPassword: true });
  });

  it("returns 404 listing Seasons for a missing Event", async () => {
    const response = await listSeasons(context({ id: "no-such-event" }, "GET"));
    expect(response.status).toBe(404);
  });

  it("returns 404 listing and creating without an Event id param", async () => {
    const listed = await listSeasons(context({}, "GET"));
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const created = await createSeason(context({}, "POST", { name: "X", ...seasonWindow() }));
    expect(listed.status).toBe(404);
    expect(created.status).toBe(404);
  });

  it("reports canManage for a non-owner event admin", async () => {
    const event = await seedEvent();
    mockCheckEventAdmin.mockResolvedValue(true);
    mockGetSession.mockResolvedValue({ user: { id: "admin-1" } });

    const response = await listSeasons(context({ id: event.id }, "GET"));

    expect(response.status).toBe(200);
    expect((await response.json()).canManage).toBe(true);
  });

  it("includes the caller's membership state on the public listing", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: "user-1" } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: player.id, userId: "user-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await listSeasons(context({ id: event.id }, "GET"));
    const body = await response.json();

    expect(body.seasons[0].currentMembership).toMatchObject({ status: "active" });
  });

  it("rejects a non-string Season name", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await createSeason(context({ id: event.id }, "POST", { name: 123, ...seasonWindow() }));

    expect(response.status).toBe(400);
  });

  it("rejects missing and unparseable registration dates", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const missingDates = await createSeason(context({ id: event.id }, "POST", { name: "No dates" }));
    const unparseable = await createSeason(context({ id: event.id }, "POST", {
      name: "Bad date",
      registrationOpensAt: "not-a-date",
      registrationClosesAt: "also-bad",
    }));

    expect(missingDates.status).toBe(400);
    expect(unparseable.status).toBe(400);
  });

  it("rejects an over-long Season name", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await createSeason(context({ id: event.id }, "POST", { name: "x".repeat(101), ...seasonWindow() }));

    expect(response.status).toBe(400);
  });

  it("lets a non-owner event admin create a Season", async () => {
    const event = await seedEvent();
    mockCheckEventAdmin.mockResolvedValue(true);
    mockGetSession.mockResolvedValue({ user: { id: "admin-1" } });

    const response = await createSeason(context({ id: event.id }, "POST", { name: "Admin Season", ...seasonWindow() }));

    expect(response.status).toBe(201);
    expect((await response.json()).season.createdByUserId).toBeUndefined();
  });

  it("returns 404 creating a Season for a missing Event", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await createSeason(context({ id: "no-such-event" }, "POST", { name: "X", ...seasonWindow() }));
    expect(response.status).toBe(404);
  });

  it("maps a Season create unique conflict to 409", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const spy = vi.spyOn(prisma.season, "create").mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      }),
    );

    const response = await createSeason(context({ id: event.id }, "POST", { name: "Race", ...seasonWindow() }));

    expect(response.status).toBe(409);
    expect(spy).toHaveBeenCalled();
  });

  it("rethrows unexpected Season create errors", async () => {
    const event = await seedEvent();
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    vi.spyOn(prisma.season, "create").mockRejectedValueOnce(new Error("boom"));

    await expect(createSeason(context({ id: event.id }, "POST", { name: "Race", ...seasonWindow() }))).rejects.toThrow("boom");
  });

  it("rate limits Season creation", async () => {
    const limited = await exhaustWriteLimit(createSeason);
    expect(limited.status).toBe(429);
  });
});

describe("Season detail GET invite-token access", () => {
  it("grants access to a pending invite matching the caller's email", async () => {
    const event = await seedEvent({ });
    const season = await seedSeason(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { accessPassword: hashPassword("secret") } });
    await prisma.user.create({ data: { id: "invitee", name: "Invitee", email: "invitee@example.test" } });
    const invite = await prisma.crewProposalInvite.create({
      data: { seasonId: season.id, invitedByUserId: "owner-1", email: "invitee@example.test", token: "tok-pending" },
    });
    mockGetSession.mockResolvedValue({ user: { id: "invitee" } });

    const response = await getSeason(context({ id: event.id, seasonId: season.id }, "GET", undefined, `?crewInviteToken=${invite.token}`));

    expect(response.status).toBe(200);
    expect((await response.json()).season.inviteToken).toBeUndefined();
  });

  it("grants access to a claimed invite held by the caller", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { accessPassword: hashPassword("secret") } });
    await prisma.user.create({ data: { id: "invitee", name: "Invitee", email: "invitee@example.test" } });
    await prisma.crewProposalInvite.create({
      data: {
        seasonId: season.id,
        invitedByUserId: "owner-1",
        email: "invitee@example.test",
        token: "tok-claimed",
        status: "claimed",
        claimedByUserId: "invitee",
        claimedAt: new Date(),
      },
    });
    mockGetSession.mockResolvedValue({ user: { id: "invitee" } });

    const response = await getSeason(context({ id: event.id, seasonId: season.id }, "GET", undefined, "?crewInviteToken=tok-claimed"));

    expect(response.status).toBe(200);
  });

  it("denies a pending invite whose email does not match the caller", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    await prisma.event.update({ where: { id: event.id }, data: { accessPassword: hashPassword("secret") } });
    await prisma.user.create({ data: { id: "invitee", name: "Invitee", email: "someone-else@example.test" } });
    await prisma.crewProposalInvite.create({
      data: { seasonId: season.id, invitedByUserId: "owner-1", email: "invitee@example.test", token: "tok-mismatch" },
    });
    mockGetSession.mockResolvedValue({ user: { id: "invitee" } });

    const response = await getSeason(context({ id: event.id, seasonId: season.id }, "GET", undefined, "?crewInviteToken=tok-mismatch"));

    expect(response.status).toBe(403);
  });

  it("denies a token that belongs to another Season", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const other = await seedSeason(event.id, { status: "cancelled" });
    await prisma.event.update({ where: { id: event.id }, data: { accessPassword: hashPassword("secret") } });
    await prisma.user.create({ data: { id: "invitee", name: "Invitee", email: "invitee@example.test" } });
    await prisma.crewProposalInvite.create({
      data: { seasonId: other.id, invitedByUserId: "owner-1", email: "invitee@example.test", token: "tok-other" },
    });
    mockGetSession.mockResolvedValue({ user: { id: "invitee" } });

    const response = await getSeason(context({ id: event.id, seasonId: season.id }, "GET", undefined, "?crewInviteToken=tok-other"));

    expect(response.status).toBe(403);
  });

  it("resolves ratings by user, by name and by EventPlayer fallback", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    await prisma.user.create({ data: { id: "fallback-user", name: "Fallback User", email: "fallback@example.test" } });
    await prisma.user.create({ data: { id: "by-name-user", name: "By Name", email: "by-name@example.test" } });
    const byUser = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "By User", userId: "user-1", rating: 500 } });
    const byName = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "By Name", rating: 600 } });
    const byFallback = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Fallback", userId: "fallback-user", rating: 777 } });
    await prisma.playerRating.create({ data: { eventId: event.id, name: "By User", userId: "user-1", rating: 1200 } });
    await prisma.playerRating.create({ data: { eventId: event.id, name: "By Name", rating: 1300 } });
    const userMembership = await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: byUser.id, userId: "user-1" } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: byName.id, userId: "by-name-user" } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: byFallback.id, userId: "fallback-user" } });
    const crew = await prisma.crew.create({
      data: { seasonId: season.id, name: "Rated", sortOrder: 0, memberships: { connect: [{ id: userMembership.id }] } },
    });
    await prisma.crew.create({ data: { seasonId: season.id, name: "Empty", sortOrder: 1 } });
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await getSeason(context({ id: event.id, seasonId: season.id }, "GET"));
    const body = await response.json();
    const rated = body.season.crews.find((entry: { id: string }) => entry.id === crew.id);
    const empty = body.season.crews.find((entry: { name: string }) => entry.name === "Empty");
    const ratingOf = (name: string) => body.season.activeMembers.find((entry: { name: string }) => entry.name === name)?.rating;

    expect(rated.members[0].rating).toBe(1200);
    expect(empty.averageRating).toBeNull();
    expect(ratingOf("By Name")).toBe(1300);
    expect(ratingOf("Fallback")).toBe(777);
  });

  it("returns 404 when Season params are missing", async () => {
    const response = await getSeason(context({}, "GET"));
    expect(response.status).toBe(404);
  });

  it("rate limits activation", async () => {
    const limited = await exhaustWriteLimit(patchSeason);
    expect(limited.status).toBe(429);
  });
});

describe("Season activation edge cases", () => {
  it("returns 404 activating with missing params", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });
    const response = await patchSeason(context({}, "PATCH", { action: "activate" }));
    expect(response.status).toBe(404);
  });

  it("rejects a non-admin with allowed access", async () => {
    const event = await seedEvent({ password: false });
    const season = await seedSeason(event.id);
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Member", userId: "user-1" } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: player.id, userId: "user-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "activate" }));

    expect(response.status).toBe(403);
  });

  it("rejects an array body as invalid JSON", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", [1, 2, 3]));

    expect(response.status).toBe(400);
  });

  it("dissolves a Crew that does not reach the minimum size", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    let n = 0;
    async function addCrew(name: string, size: number) {
      const crew = await prisma.crew.create({ data: { seasonId: season.id, name, sortOrder: n } });
      for (let i = 0; i < size; i += 1) {
        const userId = `p-${n}-${i}`;
        await prisma.user.upsert({ where: { id: userId }, update: {}, create: { id: userId, name: userId, email: `${userId}@t.test` } });
        const ep = await prisma.eventPlayer.create({ data: { eventId: event.id, name: `P${n}-${i}`, userId } });
        await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: ep.id, userId, crewId: crew.id, status: "active" } });
      }
      n += 1;
      return crew;
    }
    await addCrew("A", 3);
    await addCrew("B", 3);
    await addCrew("C", 3);
    const tiny = await addCrew("Tiny", 2);
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "activate" }));

    expect(response.status).toBe(200);
    expect(await prisma.crew.findUnique({ where: { id: tiny.id } })).toBeNull();
    const dissolved = await prisma.seasonMembership.findFirst({ where: { seasonId: season.id, crewId: null, status: "withdrawn" } });
    expect(dissolved).not.toBeNull();
  });
});

describe("Season membership edge cases", () => {
  it("denies access to a password-protected Event", async () => {
    const event = await seedEvent({ password: true });
    const season = await seedSeason(event.id);
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: "user-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id }));

    expect(response.status).toBe(403);
  });

  it("rejects invalid JSON when joining", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await joinSeason(rawContext({ id: event.id, seasonId: season.id }, "POST", "{oops"));

    expect(response.status).toBe(400);
  });

  it("rejects a second EventPlayer for the same account", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const first = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: "user-1" } });
    const second = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alicia", userId: "user-1" } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: first.id, userId: "user-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: second.id }));

    expect(response.status).toBe(409);
  });

  it("lets a non-owner admin join after registration closes", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, { closes: new Date(Date.now() - 60_000) });
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Admin Player", userId: "admin-1" } });
    mockCheckEventAdmin.mockResolvedValue(true);
    mockGetSession.mockResolvedValue({ user: { id: "admin-1" } });

    const response = await joinSeason(context({ id: event.id, seasonId: season.id }, "POST", { eventPlayerId: player.id }));

    expect(response.status).toBe(201);
  });

  it("returns 404 when joining with missing params", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await joinSeason(context({}, "POST", { eventPlayerId: "x" }));
    expect(response.status).toBe(404);
  });

  it("rate limits joining", async () => {
    const limited = await exhaustWriteLimit(joinSeason);
    expect(limited.status).toBe(429);
  });

  it("denies withdrawing from a password-protected Event", async () => {
    const event = await seedEvent({ password: true });
    const season = await seedSeason(event.id);
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await withdrawSeason(context({ id: event.id, seasonId: season.id }, "DELETE"));

    expect(response.status).toBe(403);
  });

  it("blocks withdrawal after registration closes for non-admins", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, { closes: new Date(Date.now() - 60_000) });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await withdrawSeason(context({ id: event.id, seasonId: season.id }, "DELETE"));

    expect(response.status).toBe(409);
  });

  it("returns 404 withdrawing with missing params", async () => {
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
    const response = await withdrawSeason(context({}, "DELETE"));
    expect(response.status).toBe(404);
  });

  it("is idempotent when withdrawing twice", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id);
    const player = await prisma.eventPlayer.create({ data: { eventId: event.id, name: "Alice", userId: "user-1" } });
    await prisma.seasonMembership.create({ data: { seasonId: season.id, eventPlayerId: player.id, userId: "user-1" } });
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const first = await withdrawSeason(context({ id: event.id, seasonId: season.id }, "DELETE"));
    const second = await withdrawSeason(context({ id: event.id, seasonId: season.id }, "DELETE"));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect((await second.json()).membership.status).toBe("withdrawn");
  });

  it("rate limits withdrawal", async () => {
    const limited = await exhaustWriteLimit(withdrawSeason);
    expect(limited.status).toBe(429);
  });
});
