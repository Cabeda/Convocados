import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { APIContext } from "astro";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";
import { GET as getSeason, PATCH as patchSeason } from "~/pages/api/events/[id]/seasons/[seasonId]/index";

const mockGetSession = vi.fn();
const mockCheckEventAdmin = vi.fn();

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
  checkEventAdmin: (...args: unknown[]) => mockCheckEventAdmin(...args),
}));

function context(params: Record<string, string>, method: string, body?: unknown) {
  const request = new Request("http://localhost/api/events/test", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { request, params, url: new URL(request.url) } as unknown as APIContext;
}

async function seedEvent() {
  for (const id of ["owner-1", "user-1"]) {
    await prisma.user.upsert({ where: { id }, update: {}, create: { id, name: id, email: `${id}@example.test` } });
  }
  return prisma.event.create({
    data: {
      title: "Lifecycle Event",
      location: "Pitch A",
      dateTime: new Date(Date.now() + 86400_000),
      ownerId: "owner-1",
      eloEnabled: true,
      balanced: true,
    },
  });
}

async function seedSeason(eventId: string, status: string) {
  return prisma.season.create({
    data: {
      eventId,
      name: "Lifecycle Season",
      status,
      registrationOpensAt: new Date(Date.now() - 60_000),
      registrationClosesAt: new Date(Date.now() + 14 * 86400_000),
      activatedAt: status === "active" || status === "review" ? new Date() : null,
    },
  });
}

beforeEach(async () => {
  mockGetSession.mockResolvedValue(null);
  mockCheckEventAdmin.mockResolvedValue(false);
  await resetApiRateLimitStore();
  await prisma.seasonRankSnapshot.deleteMany();
  await prisma.crewProposalInvite.deleteMany();
  await prisma.crewProposalMember.deleteMany();
  await prisma.crewProposal.deleteMany();
  await prisma.crew.deleteMany();
  await prisma.seasonMembership.deleteMany();
  await prisma.season.deleteMany();
  await prisma.eventPlayer.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PATCH season complete", () => {
  it("completes an active Season and freezes the Rank snapshot", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, "active");
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "complete" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.season).toMatchObject({ id: season.id, status: "completed" });
    const updated = await prisma.season.findUnique({ where: { id: season.id } });
    expect(updated?.status).toBe("completed");
    expect(updated?.completedAt).not.toBeNull();
    expect(await prisma.seasonRankSnapshot.count({ where: { seasonId: season.id } })).toBe(1);
  });

  it("completes a Season that is under review", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, "review");
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "complete" }));

    expect(response.status).toBe(200);
    expect((await prisma.season.findUnique({ where: { id: season.id } }))?.status).toBe("completed");
  });

  it("rejects completing a Season that is not active or under review", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, "registration");
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "complete" }));

    expect(response.status).toBe(409);
    expect((await prisma.season.findUnique({ where: { id: season.id } }))?.status).toBe("registration");
  });

  it("requires admin rights to complete", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, "active");
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "complete" }));

    expect(response.status).toBe(403);
  });
});

describe("PATCH season reopen", () => {
  it("reopens a completed Season and drops its Rank snapshot", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, "completed");
    await prisma.seasonRankSnapshot.create({
      data: { seasonId: season.id, eventId: event.id, payload: JSON.stringify({ players: [], crews: [], winner: null }) },
    });
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "reopen" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.season).toMatchObject({ id: season.id, status: "active" });
    const updated = await prisma.season.findUnique({ where: { id: season.id } });
    expect(updated?.status).toBe("active");
    expect(updated?.completedAt).toBeNull();
    expect(await prisma.seasonRankSnapshot.count({ where: { seasonId: season.id } })).toBe(0);
  });

  it("rejects reopening a Season that is not completed", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, "active");
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "reopen" }));

    expect(response.status).toBe(409);
    expect((await prisma.season.findUnique({ where: { id: season.id } }))?.status).toBe("active");
  });

  it("refuses to reopen while another Season is live", async () => {
    const event = await seedEvent();
    const completed = await seedSeason(event.id, "completed");
    await seedSeason(event.id, "active");
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: completed.id }, "PATCH", { action: "reopen" }));

    expect(response.status).toBe(409);
    expect((await prisma.season.findUnique({ where: { id: completed.id } }))?.status).toBe("completed");
  });

  it("requires admin rights to reopen", async () => {
    const event = await seedEvent();
    const season = await seedSeason(event.id, "completed");
    mockGetSession.mockResolvedValue({ user: { id: "user-1" } });

    const response = await patchSeason(context({ id: event.id, seasonId: season.id }, "PATCH", { action: "reopen" }));

    expect(response.status).toBe(403);
  });
});

describe("GET season reopen gating", () => {
  it("flags another live Season so the UI can block reopening", async () => {
    const event = await seedEvent();
    const completed = await seedSeason(event.id, "completed");
    await seedSeason(event.id, "active");
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await getSeason(context({ id: event.id, seasonId: completed.id }, "GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.season.hasOtherLiveSeason).toBe(true);
  });

  it("reports no other live Season when this one is the only one", async () => {
    const event = await seedEvent();
    const completed = await seedSeason(event.id, "completed");
    mockGetSession.mockResolvedValue({ user: { id: "owner-1" } });

    const response = await getSeason(context({ id: event.id, seasonId: completed.id }, "GET"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.season.hasOtherLiveSeason).toBe(false);
  });
});
