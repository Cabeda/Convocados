import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

vi.mock("~/lib/auth.helpers.server");
vi.mock("~/lib/leave.server");

import { getSession } from "~/lib/auth.helpers.server";
import { archiveAndLeave } from "~/lib/leave.server";
import { POST } from "~/pages/api/events/[id]/leave";

function ctx(eventId: string) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json", host: "convocados.cabeda.dev" },
  });
  return { request, params: { id: eventId } } as any;
}

let event: any;
let user: any;

beforeEach(async () => {
  await resetApiRateLimitStore();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
  await prisma.user.deleteMany();
  vi.restoreAllMocks();

  user = await prisma.user.create({
    data: { id: "u1", name: "Leaver", email: "leave@test.com", createdAt: new Date(), updatedAt: new Date() },
  });
  event = await prisma.event.create({
    data: { title: "Test", location: "Field", dateTime: new Date(Date.now() + 86400_000), teamOneName: "A", teamTwoName: "B" },
  });
  vi.mocked(getSession).mockResolvedValue({ user: { id: user.id, email: user.email } } as any);
});

describe("POST /api/events/[id]/leave", () => {
  it("returns 401 when unauthenticated", async () => {
    vi.mocked(getSession).mockResolvedValue(null as any);
    const res = await POST(ctx(event.id));
    expect(res.status).toBe(401);
  });

  it("returns 404 when user is not a player", async () => {
    const res = await POST(ctx(event.id));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error).toContain("not a player");
  });

  it("returns success when player leaves", async () => {
    await prisma.player.create({ data: { eventId: event.id, name: "Leaver", userId: user.id } });
    vi.mocked(archiveAndLeave).mockResolvedValue({ ok: true, warned: false, benchEmptyAfter: false, undo: { name: "Leaver", order: 0, userId: user.id, removedAt: Date.now() } });

    const res = await POST(ctx(event.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.warned).toBe(false);
    expect(archiveAndLeave).toHaveBeenCalledWith(expect.objectContaining({
      eventId: event.id,
      actor: { kind: "self", userId: user.id },
    }));
  });

  it("returns 404 when archiveAndLeave throws 'not found'", async () => {
    await prisma.player.create({ data: { eventId: event.id, name: "Leaver", userId: user.id } });
    vi.mocked(archiveAndLeave).mockRejectedValue(new Error("Player not found"));

    const res = await POST(ctx(event.id));
    expect(res.status).toBe(404);
  });

  it("returns 400 when archiveAndLeave throws generic error", async () => {
    await prisma.player.create({ data: { eventId: event.id, name: "Leaver", userId: user.id } });
    vi.mocked(archiveAndLeave).mockRejectedValue(new Error("Something went wrong"));

    const res = await POST(ctx(event.id));
    expect(res.status).toBe(400);
  });

  it("ignores archived players", async () => {
    await prisma.player.create({ data: { eventId: event.id, name: "Leaver", userId: user.id, archivedAt: new Date() } });
    const res = await POST(ctx(event.id));
    expect(res.status).toBe(404);
  });
});
