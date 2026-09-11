import { describe, it, expect, afterEach, vi } from "vitest";
import {
  detectDevicePushState,
  detectCurrentDevicePushState,
  base64UrlToUint8Array,
  enableDevicePush,
  disableDevicePush,
  type DevicePushInput,
} from "~/lib/devicePush";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";
const DESKTOP_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)";

function stubBrowser(opts: {
  userAgent: string;
  permission: "default" | "granted" | "denied";
  subscribe?: () => Promise<unknown>;
  getSubscription?: () => Promise<unknown>;
  matchMediaMatches?: boolean;
}) {
  const registration = {
    pushManager: {
      subscribe: opts.subscribe ?? vi.fn(async () => ({
        endpoint: "https://push.example/ep1",
        toJSON: () => ({ endpoint: "https://push.example/ep1", keys: { p256dh: "p", auth: "a" } }),
        unsubscribe: vi.fn(async () => true),
      })),
      getSubscription: opts.getSubscription ?? vi.fn(async () => null),
    },
  };
  vi.stubGlobal("navigator", {
    userAgent: opts.userAgent,
    language: "en-US",
    serviceWorker: {
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
      getRegistration: vi.fn(async () => registration),
    },
  });
  vi.stubGlobal("window", {
    PushManager: function PushManager() {},
    matchMedia: () => ({ matches: opts.matchMediaMatches ?? false }),
  });
  vi.stubGlobal("Notification", {
    permission: opts.permission,
    requestPermission: vi.fn(async () => opts.permission === "default" ? "granted" : opts.permission),
  });
  return registration;
}

function input(over: Partial<DevicePushInput> = {}): DevicePushInput {
  return {
    supported: true,
    isIos: false,
    isStandalone: false,
    permission: "default",
    hasSubscription: false,
    ...over,
  };
}

describe("detectDevicePushState", () => {
  it("reports unsupported when the browser has no Push API", () => {
    expect(detectDevicePushState(input({ supported: false }))).toBe("unsupported");
  });

  it("reports needs-install on iOS when not running standalone (PWA not installed)", () => {
    expect(detectDevicePushState(input({ isIos: true, isStandalone: false }))).toBe("needs-install");
  });

  it("needs-install wins over a denied/blocked permission on iOS in a tab", () => {
    expect(
      detectDevicePushState(input({ isIos: true, isStandalone: false, permission: "denied" })),
    ).toBe("needs-install");
  });

  it("reports blocked when permission was denied on a supported device", () => {
    expect(detectDevicePushState(input({ permission: "denied" }))).toBe("blocked");
  });

  it("reports off when supported, default permission, and no subscription", () => {
    expect(detectDevicePushState(input({ permission: "default" }))).toBe("off");
  });

  it("reports on when a subscription exists", () => {
    expect(detectDevicePushState(input({ permission: "granted", hasSubscription: true }))).toBe("on");
  });

  it("treats a stale subscription with default permission as on", () => {
    // A subscription existing is the device-level truth; permission may have
    // been reset by the browser without the subscription being revoked.
    expect(detectDevicePushState(input({ permission: "default", hasSubscription: true }))).toBe("on");
  });
});

describe("base64UrlToUint8Array", () => {
  it("decodes a base64url VAPID key to its raw bytes", () => {
    // "AQAB" (base64url) → [1, 0, 1]
    expect(Array.from(base64UrlToUint8Array("AQAB"))).toEqual([1, 0, 1]);
  });

  it("handles missing padding and url-safe characters", () => {
    // base64url of 0xfb 0xff → "-_8" (no padding)
    expect(Array.from(base64UrlToUint8Array("-_8"))).toEqual([251, 255]);
  });

  it("decodes an empty string to an empty array", () => {
    expect(Array.from(base64UrlToUint8Array(""))).toEqual([]);
  });
});

describe("enableDevicePush", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refuses on iOS in a Safari tab without calling the network — install first", async () => {
    stubBrowser({ userAgent: IPHONE_UA, permission: "default", matchMediaMatches: false });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await enableDevicePush();

    expect(result).toMatchObject({ ok: false, reason: "needs-install", state: "needs-install" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("requests notification permission before subscribing", async () => {
    stubBrowser({ userAgent: DESKTOP_UA, permission: "default", matchMediaMatches: false });
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(url);
      if (url === "/api/push/vapid-public-key") {
        return new Response(JSON.stringify({ publicKey: "AQAB" }), { status: 200 });
      }
      return new Response("{}", { status: 200 });
    }));

    const result = await enableDevicePush();

    expect(result).toMatchObject({ ok: true, state: "on" });
    expect(Notification.requestPermission).toHaveBeenCalled();
    expect(calls).toContain("/api/push/vapid-public-key");
    expect(calls).toContain("/api/push/subscribe");
  });

  it("reports blocked when the user denies the permission prompt", async () => {
    stubBrowser({ userAgent: DESKTOP_UA, permission: "default", matchMediaMatches: false });
    (Notification.requestPermission as ReturnType<typeof vi.fn>).mockResolvedValueOnce("denied");
    const fetchSpy = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchSpy);

    const result = await enableDevicePush();

    expect(result).toMatchObject({ ok: false, reason: "blocked", state: "blocked" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not re-prompt when permission is already granted", async () => {
    stubBrowser({ userAgent: DESKTOP_UA, permission: "granted", matchMediaMatches: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ publicKey: "AQAB" }), { status: 200 })));

    const result = await enableDevicePush();

    expect(result.ok).toBe(true);
    expect(Notification.requestPermission).not.toHaveBeenCalled();
  });
});

describe("disableDevicePush", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("deletes the server subscription and unsubscribes the browser", async () => {
    const unsubscribe = vi.fn(async () => true);
    stubBrowser({
      userAgent: DESKTOP_UA,
      permission: "granted",
      getSubscription: vi.fn(async () => ({ endpoint: "https://push.example/ep1", unsubscribe })),
    });
    const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method, body: init?.body });
      return new Response("{}", { status: 200 });
    }));

    const ok = await disableDevicePush();

    expect(ok).toBe(true);
    expect(unsubscribe).toHaveBeenCalled();
    const del = calls.find((c) => c.method === "DELETE");
    expect(del?.url).toBe("/api/push/subscribe");
    expect(String(del?.body)).toContain("https://push.example/ep1");
  });

  it("is a no-op (success) when this device has no subscription", async () => {
    stubBrowser({
      userAgent: DESKTOP_UA,
      permission: "default",
      getSubscription: vi.fn(async () => null),
    });
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const ok = await disableDevicePush();

    expect(ok).toBe(true);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns false when the browser has no Push API", async () => {
    vi.stubGlobal("navigator", { userAgent: DESKTOP_UA });
    expect(await disableDevicePush()).toBe(false);
  });
});

describe("detectCurrentDevicePushState", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports on when this device already has a subscription", async () => {
    stubBrowser({
      userAgent: DESKTOP_UA,
      permission: "granted",
      getSubscription: vi.fn(async () => ({ endpoint: "https://push.example/ep1" })),
    });
    expect(await detectCurrentDevicePushState()).toBe("on");
  });

  it("reports off when probing the registration throws", async () => {
    stubBrowser({ userAgent: DESKTOP_UA, permission: "default" });
    (navigator.serviceWorker.getRegistration as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error("boom"));
    expect(await detectCurrentDevicePushState()).toBe("off");
  });

  it("does not require install on iOS once running standalone", async () => {
    stubBrowser({ userAgent: IPHONE_UA, permission: "default", matchMediaMatches: true });
    expect(await detectCurrentDevicePushState()).toBe("off");
  });
});

describe("enableDevicePush — unsupported and error paths", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports unsupported when the browser has no Push API", async () => {
    vi.stubGlobal("navigator", { userAgent: DESKTOP_UA });
    const result = await enableDevicePush();
    expect(result).toMatchObject({ ok: false, reason: "unsupported", state: "unsupported" });
  });

  it("returns an error result when subscribing throws", async () => {
    stubBrowser({
      userAgent: DESKTOP_UA,
      permission: "granted",
      subscribe: vi.fn(async () => {
        throw new Error("subscription failed");
      }),
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ publicKey: "AQAB" }), { status: 200 })));

    const result = await enableDevicePush();

    expect(result).toMatchObject({ ok: false, reason: "error", state: "off" });
  });
});
