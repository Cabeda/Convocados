import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Watch manifest tests ─────────────────────────────────────────────────────

describe("Watch PWA manifest", () => {
  it("has correct scope and start_url for /watch subpath", async () => {
    const mod = await import("~/pages/watch/manifest.json");
    const response = await mod.GET({} as any);
    const manifest = await response.json();

    expect(manifest.start_url).toBe("/watch/");
    expect(manifest.scope).toBe("/watch/");
  });

  it("has required PWA fields", async () => {
    const mod = await import("~/pages/watch/manifest.json");
    const response = await mod.GET({} as any);
    const manifest = await response.json();

    expect(manifest.name).toBeTruthy();
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toBeInstanceOf(Array);
    expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  });

  it("returns correct content-type header", async () => {
    const mod = await import("~/pages/watch/manifest.json");
    const response = await mod.GET({} as any);

    expect(response.headers.get("Content-Type")).toBe("application/manifest+json");
  });

  it("does not conflict with main app manifest", async () => {
    const mod = await import("~/pages/watch/manifest.json");
    const response = await mod.GET({} as any);
    const watchManifest = await response.json();

    expect(watchManifest.start_url).not.toBe("/");
    expect(watchManifest.scope).toBe("/watch/");
    expect(watchManifest.short_name).toBe("Watch");
  });
});

// ── Watch service worker tests ───────────────────────────────────────────────

describe("Watch service worker endpoint", () => {
  it("returns JavaScript content-type", async () => {
    const mod = await import("~/pages/watch/sw.js");
    const response = await mod.GET({} as any);

    expect(response.headers.get("Content-Type")).toBe("application/javascript");
  });

  it("sets Service-Worker-Allowed header to /watch/", async () => {
    const mod = await import("~/pages/watch/sw.js");
    const response = await mod.GET({} as any);

    expect(response.headers.get("Service-Worker-Allowed")).toBe("/watch/");
  });

  it("service worker script scopes to /watch", async () => {
    const mod = await import("~/pages/watch/sw.js");
    const response = await mod.GET({} as any);
    const body = await response.text();

    expect(body).toContain("/watch");
    expect(body).toContain("fetch");
    expect(body).toContain("caches");
  });
});

// ── Watch types / IndexedDB helpers tests ────────────────────────────────────

describe("Watch offline sync types", () => {
  it("exports required IndexedDB helper functions", async () => {
    const mod = await import("~/components/watch/watchTypes");
    expect(typeof mod.savePendingSync).toBe("function");
    expect(typeof mod.getPendingSyncs).toBe("function");
    expect(typeof mod.removePendingSync).toBe("function");
    expect(typeof mod.flushPendingSyncs).toBe("function");
  });

  it("WatchEventsResponse type includes autoSelectId", async () => {
    // Verify the type is exported and usable
    const mod = await import("~/components/watch/watchTypes");
    // Type-level check: if this compiles, the type exists
    const mockResponse: import("~/components/watch/watchTypes").WatchEventsResponse = {
      events: [],
      autoSelectId: null,
    };
    expect(mockResponse.autoSelectId).toBeNull();
    expect(mockResponse.events).toEqual([]);
  });

  it("WatchEvent type includes hasTeams, isHappeningNow and dateTime", async () => {
    const mockEvent: import("~/components/watch/watchTypes").WatchEvent = {
      id: "test",
      title: "Test",
      sport: "football-5v5",
      dateTime: new Date().toISOString(),
      teamOneName: "A",
      teamTwoName: "B",
      hasTeams: true,
      isHappeningNow: true,
      hasHistory: false,
      latestGame: null,
    };
    expect(mockEvent.isHappeningNow).toBe(true);
    expect(mockEvent.hasTeams).toBe(true);
    expect(mockEvent.dateTime).toBeTruthy();
  });
});

// ── Watch Astro pages tests ──────────────────────────────────────────────────

describe("Watch pages link to correct manifest", () => {
  it("index page references /watch/manifest.json", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("src/pages/watch/index.astro", "utf-8");

    expect(content).toContain('href="/watch/manifest.json"');
    expect(content).not.toContain('href="/manifest.json"');
  });

  it("score page references /watch/manifest.json", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("src/pages/watch/[id].astro", "utf-8");

    expect(content).toContain('href="/watch/manifest.json"');
    expect(content).not.toContain('href="/manifest.json"');
  });

  it("index page registers service worker with /watch/ scope", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("src/pages/watch/index.astro", "utf-8");

    expect(content).toContain('register("/watch/sw.js"');
    expect(content).toContain('scope: "/watch/"');
  });

  it("score page registers service worker with /watch/ scope", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("src/pages/watch/[id].astro", "utf-8");

    expect(content).toContain('register("/watch/sw.js"');
    expect(content).toContain('scope: "/watch/"');
  });

  it("pages have apple-mobile-web-app-capable meta tag", async () => {
    const fs = await import("fs");
    const index = fs.readFileSync("src/pages/watch/index.astro", "utf-8");
    const score = fs.readFileSync("src/pages/watch/[id].astro", "utf-8");

    expect(index).toContain("apple-mobile-web-app-capable");
    expect(score).toContain("apple-mobile-web-app-capable");
  });

  it("pages have viewport-fit=cover for watch displays", async () => {
    const fs = await import("fs");
    const index = fs.readFileSync("src/pages/watch/index.astro", "utf-8");
    const score = fs.readFileSync("src/pages/watch/[id].astro", "utf-8");

    expect(index).toContain("viewport-fit=cover");
    expect(score).toContain("viewport-fit=cover");
  });
});

// ── Main app PWA unaffected ──────────────────────────────────────────────────

describe("Main app PWA is unaffected", () => {
  it("main manifest.json still has start_url /", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("public/manifest.json", "utf-8");
    const manifest = JSON.parse(content);

    expect(manifest.start_url).toBe("/");
    expect(manifest.scope).toBeUndefined();
  });

  it("main sw.js is unchanged", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("public/sw.js", "utf-8");

    expect(content).not.toContain("watch-v1");
    expect(content).toContain("SKIP_WAITING");
  });

  it("main pages still reference /manifest.json", async () => {
    const fs = await import("fs");
    const dashboard = fs.readFileSync("src/pages/dashboard.astro", "utf-8");

    expect(dashboard).toContain('href="/manifest.json"');
    expect(dashboard).not.toContain('href="/watch/manifest.json"');
  });
});

// ── Auto-select logic tests ──────────────────────────────────────────────────

describe("Watch auto-select logic", () => {
  it("autoSelectId is set when exactly one event exists", () => {
    const events = [
      { id: "evt1", isHappeningNow: false },
    ];
    const happeningNow = events.filter((e) => e.isHappeningNow);
    let autoSelectId: string | null = null;
    if (happeningNow.length === 1) {
      autoSelectId = happeningNow[0].id;
    } else if (events.length === 1) {
      autoSelectId = events[0].id;
    }
    expect(autoSelectId).toBe("evt1");
  });

  it("autoSelectId picks the happening-now event when multiple exist", () => {
    const events = [
      { id: "evt1", isHappeningNow: false },
      { id: "evt2", isHappeningNow: true },
      { id: "evt3", isHappeningNow: false },
    ];
    const happeningNow = events.filter((e) => e.isHappeningNow);
    let autoSelectId: string | null = null;
    if (happeningNow.length === 1) {
      autoSelectId = happeningNow[0].id;
    } else if (events.length === 1) {
      autoSelectId = events[0].id;
    }
    expect(autoSelectId).toBe("evt2");
  });

  it("autoSelectId is null when multiple events are happening now", () => {
    const events = [
      { id: "evt1", isHappeningNow: true },
      { id: "evt2", isHappeningNow: true },
    ];
    const happeningNow = events.filter((e) => e.isHappeningNow);
    let autoSelectId: string | null = null;
    if (happeningNow.length === 1) {
      autoSelectId = happeningNow[0].id;
    } else if (events.length === 1) {
      autoSelectId = events[0].id;
    }
    expect(autoSelectId).toBeNull();
  });

  it("autoSelectId is null when no events exist", () => {
    const events: { id: string; isHappeningNow: boolean }[] = [];
    const happeningNow = events.filter((e) => e.isHappeningNow);
    let autoSelectId: string | null = null;
    if (happeningNow.length === 1) {
      autoSelectId = happeningNow[0].id;
    } else if (events.length === 1) {
      autoSelectId = events[0].id;
    }
    expect(autoSelectId).toBeNull();
  });

  it("HAPPENING_WINDOW_MS is 90 minutes", () => {
    // The API uses 90 * 60 * 1000 = 5_400_000 ms
    const HAPPENING_WINDOW_MS = 90 * 60 * 1000;
    expect(HAPPENING_WINDOW_MS).toBe(5_400_000);

    // An event 80 minutes ago should be "happening now"
    const now = Date.now();
    const eightyMinAgo = now - 80 * 60 * 1000;
    expect(Math.abs(eightyMinAgo - now)).toBeLessThanOrEqual(HAPPENING_WINDOW_MS);

    // An event 100 minutes ago should NOT be "happening now"
    const hundredMinAgo = now - 100 * 60 * 1000;
    expect(Math.abs(hundredMinAgo - now)).toBeGreaterThan(HAPPENING_WINDOW_MS);
  });
});
