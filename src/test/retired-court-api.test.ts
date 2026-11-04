import { afterEach, describe, expect, it, vi } from "vitest";
import { GET as clubs } from "~/pages/api/playtomic/clubs";
import { GET as availability } from "~/pages/api/playtomic/availability";
import { GET as alternatives, PUT as watchEvent } from "~/pages/api/events/[id]/court-alternatives";
import { POST as switchCourt } from "~/pages/api/events/[id]/switch-court";
import { POST as adopt } from "~/pages/api/events/[id]/adopt";
import { GET as watches, POST as createWatch } from "~/pages/api/court-watches/index";
import { DELETE as deleteWatch } from "~/pages/api/court-watches/[id]";
import { POST as sweep } from "~/pages/api/cron/pickups";
import { POST as eventSweep } from "~/pages/api/cron/court-watch";
import { POST as standaloneSweep } from "~/pages/api/cron/court-watches";

afterEach(() => vi.unstubAllGlobals());

describe("retired court integration", () => {
  it.each([
    ["GET", "/api/playtomic/clubs", clubs],
    ["GET", "/api/playtomic/availability", availability],
    ["GET", "/api/events/event/court-alternatives", alternatives],
    ["PUT", "/api/events/event/court-alternatives", watchEvent],
    ["POST", "/api/events/event/switch-court", switchCourt],
    ["POST", "/api/events/event/adopt", adopt],
    ["GET", "/api/court-watches", watches],
    ["POST", "/api/court-watches", createWatch],
    ["DELETE", "/api/court-watches/watch", deleteWatch],
    ["POST", "/api/cron/pickups", sweep],
    ["POST", "/api/cron/court-watch", eventSweep],
    ["POST", "/api/cron/court-watches", standaloneSweep],
  ] as const)("returns Gone for %s %s without contacting the upstream", async (method, path, handler) => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    const response = await handler({ request: new Request(`http://localhost${path}`, { method }), params: { id: "event" } } as never);
    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({ error: "Court discovery has been retired. Enter a venue manually when creating or editing a game." });
    expect(fetch).not.toHaveBeenCalled();
  });
});
