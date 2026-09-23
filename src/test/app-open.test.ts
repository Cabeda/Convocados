import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("~/lib/logger.server", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

vi.mock("~/lib/auth.helpers.server", () => ({
  getSession: vi.fn(),
}));

import { prisma } from "~/lib/db.server";
import { isTrackableAppOpen } from "~/lib/appOpen";
import { trackAppOpen } from "~/lib/appOpen.server";
import { getSession } from "~/lib/auth.helpers.server";

function nav(headers: Record<string, string> = {}, urlStr = "https://convocados.cabeda.dev/games") {
  return new Request(urlStr, { method: "GET", headers });
}

type Session = Awaited<ReturnType<typeof getSession>>;
const asSession = (id: string) => ({ user: { id } }) as unknown as Session;

describe("isTrackableAppOpen", () => {
  it("counts an HTML GET navigation that carries a session cookie", () => {
    expect(isTrackableAppOpen(nav({ cookie: "session=abc", accept: "text/html" }), new URL("https://x/games"))).toBe(true);
  });

  it("ignores requests without a cookie (anonymous)", () => {
    expect(isTrackableAppOpen(nav({ accept: "text/html" }), new URL("https://x/games"))).toBe(false);
  });

  it("ignores non-HTML requests (API / JSON clients)", () => {
    expect(isTrackableAppOpen(nav({ cookie: "s=1", accept: "application/json" }), new URL("https://x/games"))).toBe(false);
  });

  it("ignores API routes", () => {
    expect(isTrackableAppOpen(nav({ cookie: "s=1", accept: "text/html" }), new URL("https://x/api/me/games"))).toBe(false);
  });

  it("ignores framework and asset paths", () => {
    expect(isTrackableAppOpen(nav({ cookie: "s=1", accept: "text/html" }), new URL("https://x/icons/icon-192.png"))).toBe(false);
    expect(isTrackableAppOpen(nav({ cookie: "s=1", accept: "text/html" }), new URL("https://x/_astro/app.js"))).toBe(false);
  });

  it("ignores non-GET methods", () => {
    const post = new Request("https://x/games", { method: "POST", headers: { cookie: "s=1", accept: "text/html" } });
    expect(isTrackableAppOpen(post, new URL("https://x/games"))).toBe(false);
  });
});

describe("trackAppOpen", () => {
  beforeEach(async () => {
    await prisma.userAppOpen.deleteMany();
    await prisma.user.deleteMany();
    vi.mocked(getSession).mockReset();
  });

  it("records a heartbeat for the signed-in user", async () => {
    const user = await prisma.user.create({
      data: { id: "u-open-1", name: "Alice", email: "alice-open@t.com", emailVerified: true },
    });
    vi.mocked(getSession).mockResolvedValue(asSession(user.id));

    await trackAppOpen(nav({ cookie: "s=1" }));

    const rows = await prisma.userAppOpen.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
  });

  it("is idempotent per day", async () => {
    const user = await prisma.user.create({
      data: { id: "u-open-2", name: "Bob", email: "bob-open@t.com", emailVerified: true },
    });
    vi.mocked(getSession).mockResolvedValue(asSession(user.id));

    await trackAppOpen(nav({ cookie: "s=1" }));
    await trackAppOpen(nav({ cookie: "s=1" }));

    expect(await prisma.userAppOpen.count({ where: { userId: user.id } })).toBe(1);
  });

  it("does nothing for an anonymous request", async () => {
    vi.mocked(getSession).mockResolvedValue(null);

    await trackAppOpen(nav());

    expect(await prisma.userAppOpen.count()).toBe(0);
  });

  it("swallows session errors instead of breaking the page", async () => {
    vi.mocked(getSession).mockRejectedValue(new Error("boom"));

    await expect(trackAppOpen(nav({ cookie: "s=1" }))).resolves.toBeUndefined();
  });
});
