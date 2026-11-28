import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PushPromptBanner } from "~/components/PushPromptBanner";
import { stubPushBrowser } from "./pushBrowser";
import { INSTALL_BANNER_DISMISS_KEY } from "~/lib/pushPrompt";

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PushPromptBanner — iOS Safari tab", () => {
  it("shows install guidance instead of bailing silently once the install banner is dismissed", async () => {
    stubPushBrowser({ userAgent: IPHONE_UA, permission: "default", standalone: false, hasSubscription: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    localStorage.setItem(INSTALL_BANNER_DISMISS_KEY, String(Date.now()));

    renderWithTheme(<PushPromptBanner followCount={1} />);

    expect(await screen.findByText(/add convocados to your home screen/i)).toBeInTheDocument();
  });

  it("stays quiet while the global install banner is still showing", () => {
    stubPushBrowser({ userAgent: IPHONE_UA, permission: "default", standalone: false, hasSubscription: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    renderWithTheme(<PushPromptBanner followCount={1} />);

    expect(screen.queryByText(/add convocados to your home screen/i)).not.toBeInTheDocument();
  });
});

describe("PushPromptBanner — quiet row (the event page)", () => {
  it("is one plain row, not a coloured box, and not an alert: it is static text", async () => {
    stubPushBrowser({ permission: "default", standalone: false, hasSubscription: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { container } = renderWithTheme(<PushPromptBanner followCount={1} forceOnEventDetail quiet />);
    expect(await screen.findByText(/enable notifications to get game reminders/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(container.querySelector(".MuiAlert-root")).toBeNull();
    expect(screen.getByRole("button", { name: "Enable" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeInTheDocument();
  });

  it("takes no room at all while there is nothing to say", async () => {
    stubPushBrowser({ permission: "granted", standalone: false, hasSubscription: true });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    const { container } = renderWithTheme(<PushPromptBanner followCount={1} forceOnEventDetail quiet />);
    await new Promise((r) => setTimeout(r, 20));
    expect(container).toBeEmptyDOMElement();
  });

  it("says plainly that notifications are blocked, with the way to fix it, and is no alert either", async () => {
    stubPushBrowser({ permission: "denied", standalone: false, hasSubscription: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    renderWithTheme(<PushPromptBanner followCount={1} forceOnEventDetail quiet />);
    expect(await screen.findByText(/notifications are blocked/i)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Enable" })).toBeInTheDocument();
  });

  it("still asks high-intent people in a dialog", async () => {
    stubPushBrowser({ permission: "default", standalone: false, hasSubscription: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
    renderWithTheme(<PushPromptBanner followCount={1} forceOnEventDetail highIntent quiet />);
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });
});

describe("PushPromptBanner — desktop", () => {
  it("still shows the regular enable prompt", async () => {
    stubPushBrowser({ permission: "default", standalone: false, hasSubscription: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    renderWithTheme(<PushPromptBanner followCount={1} />);

    expect(await screen.findByText(/enable notifications to get game reminders/i)).toBeInTheDocument();
  });
});
