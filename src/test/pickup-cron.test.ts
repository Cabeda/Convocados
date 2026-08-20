import { describe, it, expect, beforeEach, vi } from "vitest";

const mockRunSweep = vi.fn().mockResolvedValue({ anchors: 2, clubs: 5, created: 3, skipped: 0, errors: [] });
vi.mock("~/lib/pickupSweep.server", () => ({
  runPickupSweep: (...args: unknown[]) => mockRunSweep(...args),
  resolveAnchors: () => {
    const raw = process.env.SWEEP_ANCHORS ?? "";
    if (!raw) return [{ city: "Porto", lat: 41.15, lng: -8.6, timezone: "Europe/Lisbon" }, { city: "Lisbon", lat: 38.72, lng: -9.14, timezone: "Europe/Lisbon" }];
    return JSON.parse(raw);
  },
  archiveExpiredPickups: vi.fn().mockResolvedValue(0),
}));

const { POST } = await import("~/pages/api/cron/pickups");

beforeEach(async () => {
  vi.clearAllMocks();
  delete process.env.CRON_SECRET;
  delete process.env.SWEEP_ANCHORS;
  mockRunSweep.mockResolvedValue({ anchors: 2, clubs: 5, created: 3, skipped: 0, errors: [] });
});

function cronReq(token?: string) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  return { request: new Request("http://localhost/api/cron/pickups", { method: "POST", headers }) } as any;
}

describe("POST /api/cron/pickups", () => {
  it("rejects requests without the cron secret", async () => {
    process.env.CRON_SECRET = "secret";
    const res = await POST(cronReq());
    expect(res.status).toBe(401);
    expect(mockRunSweep).not.toHaveBeenCalled();
  });

  it("runs the sweep with the configured anchors and returns counts", async () => {
    process.env.CRON_SECRET = "secret";
    process.env.SWEEP_ANCHORS = JSON.stringify([
      { city: "Porto", lat: 41.15, lng: -8.6, timezone: "Europe/Lisbon" },
    ]);
    const res = await POST(cronReq("secret"));
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(mockRunSweep).toHaveBeenCalledTimes(1);
    const [anchors] = mockRunSweep.mock.calls[0];
    expect(anchors).toEqual([{ city: "Porto", lat: 41.15, lng: -8.6, timezone: "Europe/Lisbon" }]);
    expect(data).toEqual({ ok: true, anchors: 2, clubs: 5, created: 3, skipped: 0, errors: [], archived: 0 });
  });

  it("falls back to the default anchors when none are configured", async () => {
    process.env.CRON_SECRET = "secret";
    const res = await POST(cronReq("secret"));
    const data = await res.json();

    expect(data.ok).toBe(true);
    const [anchors] = mockRunSweep.mock.calls[0];
    expect(anchors).toHaveLength(2);
    expect(anchors[0].city).toBe("Porto");
    expect(anchors[1].city).toBe("Lisbon");
  });
});