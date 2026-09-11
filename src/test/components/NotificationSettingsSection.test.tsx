import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { NotificationSettingsSection } from "~/components/NotificationSettingsSection";
import { stubPushBrowser } from "./pushBrowser";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function stubPrefsFetch() {
  return vi.fn(async () => new Response("{}", { status: 200 }));
}

describe("NotificationSettingsSection — device state", () => {
  it("shows this device's push state alongside the account settings", async () => {
    stubPushBrowser({ hasSubscription: false, permission: "default" });
    vi.stubGlobal("fetch", stubPrefsFetch());

    renderWithTheme(<NotificationSettingsSection />);

    expect(await screen.findByText("This device")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /enable on this device/i })).toBeInTheDocument();
  });

  it("refuses to claim the device is on when it is not subscribed", async () => {
    stubPushBrowser({ hasSubscription: false, permission: "default" });
    vi.stubGlobal("fetch", stubPrefsFetch());

    renderWithTheme(<NotificationSettingsSection />);

    expect(await screen.findByText(/notifications are off on this device/i)).toBeInTheDocument();
  });
});
