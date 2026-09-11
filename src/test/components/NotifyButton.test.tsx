/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { NotifyButton } from "~/components/event/NotifyButton";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubFetch(handlers: {
  get?: { following: boolean; isPlayer: boolean };
  delete?: () => Response;
  post?: () => Response;
}) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    if (method === "DELETE") return handlers.delete?.() ?? new Response("{}", { status: 200 });
    if (method === "POST") return handlers.post?.() ?? new Response("{}", { status: 200 });
    return new Response(JSON.stringify(handlers.get ?? {}), { status: 200 });
  });
}

describe("NotifyButton follow toggle", () => {
  it("shows the Follow button for a player who is NOT following", async () => {
    vi.stubGlobal("fetch", stubFetch({ get: { following: false, isPlayer: true } }));

    renderWithTheme(<NotifyButton eventId="e1" isAuthenticated />);

    // Regression: a player added to the roster by an organizer is NOT auto-followed.
    // The toggle must still render so they can opt into notifications.
    expect(await screen.findByText(/follow game/i)).toBeInTheDocument();
  });

  it("shows the toggle for an auto-followed player so they can opt out", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        get: { following: true, isPlayer: true },
        delete: () => new Response(JSON.stringify({ ok: true, following: false }), { status: 200 }),
      }),
    );

    const user = userEvent.setup();
    renderWithTheme(<NotifyButton eventId="e1" isAuthenticated />);

    const followingBtn = await screen.findByText(/following/i);
    await user.click(followingBtn);

    expect(await screen.findByText(/follow game/i)).toBeInTheDocument();
  });

  it("non-player follower can unfollow and the Follow button reappears", async () => {
    vi.stubGlobal(
      "fetch",
      stubFetch({
        get: { following: true, isPlayer: false },
        delete: () => new Response(JSON.stringify({ ok: true, following: false }), { status: 200 }),
      }),
    );

    const user = userEvent.setup();
    renderWithTheme(<NotifyButton eventId="e1" isAuthenticated />);

    const followingBtn = await screen.findByText(/following/i);
    await user.click(followingBtn);

    expect(await screen.findByText(/follow game/i)).toBeInTheDocument();
  });

  it("on follow, asks for notification permission before subscribing this device", async () => {
    const registration = {
      pushManager: {
        getSubscription: vi.fn(async () => null),
        subscribe: vi.fn(async () => ({
          endpoint: "https://push.example/ep1",
          toJSON: () => ({ endpoint: "https://push.example/ep1", keys: { p256dh: "p", auth: "a" } }),
        })),
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
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    vi.stubGlobal("PushManager", function PushManager() {});
    vi.stubGlobal("Notification", { permission: "default", requestPermission: vi.fn(async () => "granted") });

    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/push/vapid-public-key") {
        calls.push(url);
        return new Response(JSON.stringify({ publicKey: "AQAB" }), { status: 200 });
      }
      const method = init?.method ?? "GET";
      if (method === "GET") return new Response(JSON.stringify({ following: false, isPlayer: true }), { status: 200 });
      calls.push(url);
      return new Response("{}", { status: 200 });
    }));

    const user = userEvent.setup();
    renderWithTheme(<NotifyButton eventId="e1" isAuthenticated />);
    await user.click(await screen.findByText(/follow game/i));

    await waitFor(() => {
      expect(Notification.requestPermission).toHaveBeenCalled();
      expect(calls).toContain("/api/push/subscribe");
    });
  });

  it("on iOS in a Safari tab, tells the user to install instead of silently failing", async () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)");
    vi.stubGlobal("PushManager", function PushManager() {});
    vi.stubGlobal("Notification", { permission: "default", requestPermission: vi.fn(async () => "granted") });
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "GET") return new Response(JSON.stringify({ following: false, isPlayer: true }), { status: 200 });
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const user = userEvent.setup();
    renderWithTheme(<NotifyButton eventId="e1" isAuthenticated />);
    await user.click(await screen.findByText(/follow game/i));

    expect(await screen.findByText(/add convocados to your home screen/i)).toBeInTheDocument();
    // Not subscribed — no network call to the subscribe endpoint.
    expect(fetchSpy.mock.calls.every(([url]) => !String(url).includes("/api/push/subscribe"))).toBe(true);
  });
});;
