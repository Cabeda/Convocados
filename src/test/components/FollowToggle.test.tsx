/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { FollowToggle } from "~/components/event/story/FollowToggle";

afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function stubFetch(o: { following?: boolean; post?: () => Response | Promise<Response>; del?: () => Response | Promise<Response>; other?: (url: string) => Response | null } = {}) {
  const fn = vi.fn(async (url: string, init?: RequestInit) => {
    const hit = o.other?.(url);
    if (hit) return hit;
    if (url === "/api/push/vapid-public-key") return json({ publicKey: "AQAB" });
    const method = init?.method ?? "GET";
    if (method === "DELETE") return o.del?.() ?? json({ ok: true });
    if (method === "POST") return o.post?.() ?? json({ ok: true });
    return json({ following: o.following ?? false, isPlayer: true });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

function stubPushBrowser(opts: { userAgent?: string; permission?: "default" | "granted" | "denied" } = {}) {
  const registration = {
    pushManager: {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn(async () => ({ endpoint: "https://push.example/ep1", toJSON: () => ({ endpoint: "https://push.example/ep1", keys: { p256dh: "p", auth: "a" } }) })),
    },
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: { register: vi.fn(async () => registration), ready: Promise.resolve(registration), getRegistration: vi.fn(async () => registration) },
  });
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(opts.userAgent ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
  vi.stubGlobal("PushManager", function PushManager() {});
  vi.stubGlobal("Notification", { permission: opts.permission ?? "default", requestPermission: vi.fn(async () => (opts.permission === "denied" ? "denied" : "granted")) });
}

const setup = async (toasts: string[] = []) => {
  const user = userEvent.setup();
  renderWithTheme(<FollowToggle eventId="e1" onToast={(m) => toasts.push(m)} />);
  // The toggle waits for the server's answer so a tap never goes the wrong way.
  const button = await screen.findByRole("button", { name: /^(Follow game|Following)$/ });
  await waitFor(() => expect(button).toBeEnabled());
  return { user, button };
};

describe("FollowToggle", () => {
  it("is disabled until the server has said whether you follow, instead of guessing \"not following\"", async () => {
    let answer;
    vi.stubGlobal("fetch", vi.fn(() => new Promise((r) => { answer = () => r(json({ following: true })); })));
    renderWithTheme(<FollowToggle eventId="e1" onToast={() => {}} />);
    const button = screen.getByRole("button", { name: "Follow game" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    answer();
    await waitFor(() => expect(screen.getByRole("button", { name: "Following" })).toBeEnabled());
  });

  it("stays disabled and says why when the first lookup fails, rather than offering a wrong Follow", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ error: "no" }, 500)));
    renderWithTheme(<FollowToggle eventId="e1" onToast={() => {}} />);
    const button = screen.getByRole("button", { name: "Follow game" });
    await waitFor(() => expect(button).toHaveAttribute("title", "Couldn't check whether you follow this game. Reload the page to try again."));
    expect(button).toBeDisabled();
  });

  it("shows the state the server holds, for a player added by an organiser and for a follower alike", async () => {
    stubFetch({ following: true });
    const { button } = await setup();
    await waitFor(() => expect(button).toHaveTextContent("Following"));
  });

  it("flips at once on tap, then sticks when the server agrees", async () => {
    let release;
    stubFetch({ post: () => new Promise((r) => { release = () => r(json({ ok: true })); }) });
    stubPushBrowser();
    const toasts: string[] = [];
    const { user, button } = await setup(toasts);
    await user.click(button);
    expect(button).toHaveTextContent("Following");
    release();
    await waitFor(() => expect(toasts).toContain("You'll get reminders for this game"));
    expect(button).toHaveTextContent("Following");
  });

  it("flips back and says so when the server refuses", async () => {
    stubFetch({ post: () => json({ error: "no" }, 500) });
    const toasts: string[] = [];
    const { user, button } = await setup(toasts);
    await user.click(button);
    await waitFor(() => expect(button).toHaveTextContent("Follow game"));
    expect(toasts).toContain("Couldn't follow. Check your connection and try again.");
  });

  it("unfollows with the same button and a plain toast", async () => {
    stubFetch({ following: true });
    const toasts: string[] = [];
    const { user, button } = await setup(toasts);
    await waitFor(() => expect(button).toHaveTextContent("Following"));
    await user.click(button);
    expect(button).toHaveTextContent("Follow game");
    await waitFor(() => expect(toasts).toContain("Removed from My Games"));
  });

  it("sends one request however many times it is tapped while waiting", async () => {
    let release;
    const f = stubFetch({ post: () => new Promise((r) => { release = () => r(json({ ok: true })); }) });
    stubPushBrowser();
    const { user, button } = await setup();
    await user.click(button);
    await user.click(button);
    await user.click(button);
    release();
    await waitFor(() => expect(button).toHaveTextContent("Following"));
    expect(f.mock.calls.filter(([url, init]) => String(url).endsWith("/follow") && init?.method !== "GET")).toHaveLength(1);
  });

  it("on follow, asks for notification permission before subscribing this device", async () => {
    stubPushBrowser({ permission: "default" });
    const f = stubFetch();
    const { user, button } = await setup();
    await user.click(button);
    await waitFor(() => {
      expect(Notification.requestPermission).toHaveBeenCalled();
      expect(f.mock.calls.some(([url]) => url === "/api/push/subscribe")).toBe(true);
    });
  });

  it("on iOS in a Safari tab, tells the user to install instead of silently failing", async () => {
    stubPushBrowser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)" });
    const f = stubFetch();
    const toasts: string[] = [];
    const { user, button } = await setup(toasts);
    await user.click(button);
    await waitFor(() => expect(toasts.join(" ")).toMatch(/add convocados to your home screen/i));
    expect(f.mock.calls.some(([url]) => url === "/api/push/subscribe")).toBe(false);
  });

  it("surfaces a blocked permission and a subscribe failure instead of dropping them", async () => {
    stubPushBrowser({ permission: "denied" });
    stubFetch();
    let toasts: string[] = [];
    let { user, button } = await setup(toasts);
    await user.click(button);
    await waitFor(() => expect(toasts.join(" ")).toMatch(/blocked in your browser settings/i));
    cleanup();
    stubPushBrowser({ permission: "granted" });
    stubFetch({ other: (url) => (url === "/api/push/subscribe" ? new Response("boom", { status: 500 }) : null) });
    toasts = [];
    ({ user, button } = await setup(toasts));
    await user.click(button);
    await waitFor(() => expect(toasts.join(" ")).toMatch(/couldn't enable notifications/i));
  });
});
