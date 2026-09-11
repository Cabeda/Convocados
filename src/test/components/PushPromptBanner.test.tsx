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

describe("PushPromptBanner — desktop", () => {
  it("still shows the regular enable prompt", async () => {
    stubPushBrowser({ permission: "default", standalone: false, hasSubscription: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));

    renderWithTheme(<PushPromptBanner followCount={1} />);

    expect(await screen.findByText(/enable notifications to get game reminders/i)).toBeInTheDocument();
  });
});
