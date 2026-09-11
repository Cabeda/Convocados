import { vi } from "vitest";

export interface PushBrowserOptions {
  hasSubscription?: boolean;
  permission?: "default" | "granted" | "denied";
  userAgent?: string;
  standalone?: boolean;
}

/**
 * Stub the browser surfaces device push depends on (service worker, PushManager,
 * Notification, userAgent, standalone) inside the jsdom project. Restore in
 * afterEach with `vi.restoreAllMocks(); vi.unstubAllGlobals();`.
 */
export function stubPushBrowser(opts: PushBrowserOptions = {}) {
  const unsubscribe = vi.fn(async () => true);
  let has = opts.hasSubscription ?? false;
  const makeSub = () => ({
    endpoint: "https://push.example/ep1",
    unsubscribe,
    toJSON: () => ({ endpoint: "https://push.example/ep1", keys: { p256dh: "p", auth: "a" } }),
  });
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => (has ? makeSub() : null)),
      subscribe: vi.fn(async () => {
        has = true;
        return makeSub();
      }),
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: {
      register: vi.fn(async () => registration),
      ready: Promise.resolve(registration),
      getRegistration: vi.fn(async () => registration),
    },
  });
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(
    opts.userAgent ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  );
  vi.stubGlobal("PushManager", function PushManager() {});
  if (opts.standalone !== undefined) {
    vi.spyOn(window, "matchMedia").mockReturnValue({
      matches: opts.standalone,
      media: "(display-mode: standalone)",
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    } as MediaQueryList);
  }
  vi.stubGlobal("Notification", {
    permission: opts.permission ?? "default",
    requestPermission: vi.fn(async () => (opts.permission === "denied" ? "denied" : "granted")),
  });
  return { registration, unsubscribe };
}
