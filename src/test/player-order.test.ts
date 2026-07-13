import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "~/lib/db.server";
import { resetRateLimitStore } from "~/lib/rateLimit.server";
import { resetApiRateLimitStore } from "~/lib/apiRateLimit.server";

// Mock auth helpers — unauthenticated by default
vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn().mockResolvedValue(null),
  checkOwnership: vi.fn().mockResolvedValue({ isOwner: true, isAdmin: false, session: null }),
  checkEventAdmin: vi.fn().mockResolvedValue(false),
}));

import { POST as addPlayer } from "~/pages/api/events/[id]/players";
import { GET as getEvent } from "~/pages/api/events/[id]/index";

function postCtx(params: Record<string, string>, body: unknown) {
  const request = new Request("http://localhost/api/test", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { request, params } as any;
}

function getCtx(params: Record<string, string>) {
  const request = new Request("http://localhost/api/test", {
    method: "GET",
    headers: { "content-type": "application/json" },
  });
  return { request, params, url: new URL("http://localhost/api/test") } as any;
}

beforeEach(async () => {
  await resetRateLimitStore();
  await resetApiRateLimitStore();
  await prisma.player.deleteMany();
  await prisma.event.deleteMany();
});

describe("Player ordering — new players always go to the end", () => {
  it("adds player at end even when order values have gaps", async () => {
    // Seed an event with players that have non-contiguous order values
    // (simulates state after removals/reorders over time)
    const event = await prisma.event.create({
      data: {
        title: "Order Gap Test",
        location: "Pitch A",
        dateTime: new Date(Date.now() + 86400_000),
      },
    });

    // Create players with gapped order values: 0, 1, 5, 9
    const playerNames = ["Alice", "Bob", "Charlie", "Diana"];
    const orders = [0, 1, 5, 9];
    for (let i = 0; i < playerNames.length; i++) {
      await prisma.player.create({
        data: {
          name: playerNames[i],
          eventId: event.id,
          order: orders[i],
        },
      });
    }

    // Add a new player via the API
    const res = await addPlayer(postCtx({ id: event.id }, { name: "Manecas" }));
    expect(res.status).toBe(200);

    // Fetch the event and check player order
    const getRes = await getEvent(getCtx({ id: event.id }));
    const data = await getRes.json();
    const names = data.players.map((p: any) => p.name);

    // Manecas must be LAST — order should be max(existing) + 1 = 10
    expect(names[names.length - 1]).toBe("Manecas");

    // Verify the actual order value is 10 (9 + 1), not 4 (length of existing)
    const manecas = await prisma.player.findFirst({
      where: { eventId: event.id, name: "Manecas" },
    });
    expect(manecas!.order).toBe(10);
  });
});
