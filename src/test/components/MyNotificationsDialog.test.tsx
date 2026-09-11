/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { MyNotificationsDialog } from "~/components/event/MyNotificationsDialog";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubBrowser(opts: {
  hasSubscription: boolean;
  permission?: "default" | "granted" | "denied";
  userAgent?: string;
  standalone?: boolean;
}) {
  const unsubscribe = vi.fn(async () => true);
  let has = opts.hasSubscription;
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
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    });
  }
  vi.stubGlobal("Notification", {
    permission: opts.permission ?? "default",
    requestPermission: vi.fn(async () => (opts.permission === "denied" ? "denied" : "granted")),
  });
  return { subscription: makeSub(), unsubscribe };
}

function stubFetch(overrides: { follow?: Record<string, unknown> } = {}) {
  const calls: Array<{ url: string; method?: string; body?: unknown }> = [];
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method, body: init?.body });
    if (url.includes("/api/events/") && url.endsWith("/follow")) {
      return new Response(JSON.stringify({ following: true, isPlayer: true, pushEnabled: true, ...overrides.follow }), { status: 200 });
    }
    if (url === "/api/push/vapid-public-key") {
      return new Response(JSON.stringify({ publicKey: "AQAB" }), { status: 200 });
    }
    return new Response("{}", { status: 200 });
  });
  return { fn, calls };
}

describe("MyNotificationsDialog — this device section", () => {
  it("shows This device and an enable action when the device has no subscription", async () => {
    stubBrowser({ hasSubscription: false });
    vi.stubGlobal("fetch", stubFetch().fn);

    renderWithTheme(<MyNotificationsDialog eventId="e1" open onClose={() => {}} />);

    expect(await screen.findByText("This device")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enable on this device/i })).toBeInTheDocument();
  });

  it("separates device state from account settings", async () => {
    stubBrowser({ hasSubscription: false });
    vi.stubGlobal("fetch", stubFetch().fn);

    renderWithTheme(<MyNotificationsDialog eventId="e1" open onClose={() => {}} />);

    expect(await screen.findByText(/your account/i)).toBeInTheDocument();
    expect(screen.getByText("This device")).toBeInTheDocument();
  });

  it("enables the device and flips to an On state", async () => {
    stubBrowser({ hasSubscription: false });
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);

    const user = userEvent.setup();
    renderWithTheme(<MyNotificationsDialog eventId="e1" open onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /enable on this device/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /turn off on this device/i })).toBeInTheDocument();
    });
    expect(calls.some((c) => c.url === "/api/push/subscribe" && c.method === "POST")).toBe(true);
  });

  it("shows an On state with a disable action when already subscribed", async () => {
    stubBrowser({ hasSubscription: true, permission: "granted" });
    vi.stubGlobal("fetch", stubFetch().fn);

    renderWithTheme(<MyNotificationsDialog eventId="e1" open onClose={() => {}} />);

    expect(await screen.findByText(/notifications are on for this device/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /turn off on this device/i })).toBeInTheDocument();
  });

  it("disables the device, calling DELETE with the endpoint", async () => {
    stubBrowser({ hasSubscription: true, permission: "granted" });
    const { fn, calls } = stubFetch();
    vi.stubGlobal("fetch", fn);

    const user = userEvent.setup();
    renderWithTheme(<MyNotificationsDialog eventId="e1" open onClose={() => {}} />);

    await user.click(await screen.findByRole("button", { name: /turn off on this device/i }));

    await waitFor(() => {
      expect(calls.some((c) => c.url === "/api/push/subscribe" && c.method === "DELETE")).toBe(true);
    });
  });

  it("shows a blocked hint when the permission is denied", async () => {
    stubBrowser({ hasSubscription: false, permission: "denied" });
    vi.stubGlobal("fetch", stubFetch().fn);

    renderWithTheme(<MyNotificationsDialog eventId="e1" open onClose={() => {}} />);

    expect(await screen.findByText(/blocked/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /enable on this device/i })).not.toBeInTheDocument();
  });

  it("tells iOS users in a tab to install the app first", async () => {
    stubBrowser({
      hasSubscription: false,
      userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)",
    });
    vi.stubGlobal("fetch", stubFetch().fn);

    renderWithTheme(<MyNotificationsDialog eventId="e1" open onClose={() => {}} />);

    expect(await screen.findByText(/add convocados to your home screen/i)).toBeInTheDocument();
  });
});
