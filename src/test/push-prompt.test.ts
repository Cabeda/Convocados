import { describe, it, expect } from "vitest";
import {
  isIos,
  isStandalone,
  resolveIosHelpLink,
  installBannerDismissed,
  INSTALL_BANNER_DISMISS_KEY,
} from "~/lib/pushPrompt";

// ── Platform detection ──────────────────────────────────────────────────────

describe("isIos", () => {
  it("matches iPhone user agent", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe(true);
  });
  it("matches iPad user agent", () => {
    expect(isIos("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe(true);
  });
  it("matches iPod", () => {
    expect(isIos("Mozilla/5.0 (iPod touch; CPU iPhone OS 15_0 like Mac OS X)")).toBe(true);
  });
  it("returns false on Android", () => {
    expect(isIos("Mozilla/5.0 (Linux; Android 14)")).toBe(false);
  });
  it("returns false on desktop", () => {
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe(false);
  });
});

describe("isStandalone", () => {
  it("returns true for display-mode: standalone", () => {
    expect(isStandalone({
      displayModeStandalone: true,
      navigatorStandalone: undefined,
    })).toBe(true);
  });
  it("returns true for navigator.standalone (iOS PWA)", () => {
    expect(isStandalone({
      displayModeStandalone: false,
      navigatorStandalone: true,
    })).toBe(true);
  });
  it("returns false for regular browser tab", () => {
    expect(isStandalone({
      displayModeStandalone: false,
      navigatorStandalone: false,
    })).toBe(false);
  });
  it("returns false when both undefined", () => {
    expect(isStandalone({
      displayModeStandalone: false,
      navigatorStandalone: undefined,
    })).toBe(false);
  });
});

// ── iOS help-link resolution ────────────────────────────────────────────────

describe("resolveIosHelpLink", () => {
  it("returns iOS Safari Settings path for iPhone UA", () => {
    expect(resolveIosHelpLink("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"))
      .toBe("/settings?focus=notifications#safari");
  });
  it("returns iOS Safari Settings path for iPad", () => {
    expect(resolveIosHelpLink("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)"))
      .toBe("/settings?focus=notifications#safari");
  });
  it("returns the docs fallback on non-iOS Android (no system settings URL)", () => {
    expect(resolveIosHelpLink("Mozilla/5.0 (Linux; Android 14)")).toBe("/docs/push");
  });
  it("returns Firefox link on Firefox", () => {
    expect(resolveIosHelpLink(
      "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"
    )).toBe("about:preferences#content-notifications");
  });
  it("returns Chrome link on Chrome", () => {
    expect(resolveIosHelpLink(
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0"
    )).toBe("chrome://settings/content/notifications");
  });
  it("returns Edge link on Edge", () => {
    expect(resolveIosHelpLink(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Edg/120.0"
    )).toBe("chrome://settings/content/notifications");
  });
  it("falls back to docs for unknown browser", () => {
    expect(resolveIosHelpLink("curl/8.0")).toBe("/docs/push");
  });
});

// ── install banner dismissal ────────────────────────────────────────────────

function storageWith(value: string | null) {
  return { getItem: (key: string) => (key === INSTALL_BANNER_DISMISS_KEY ? value : null) };
}

describe("installBannerDismissed", () => {
  const now = 1_000_000_000_000_000;

  it("is false when nothing was stored", () => {
    expect(installBannerDismissed(storageWith(null), now)).toBe(false);
  });

  it("is true when dismissed within the cooldown window", () => {
    expect(installBannerDismissed(storageWith(String(now - 24 * 60 * 60 * 1000)), now)).toBe(true);
  });

  it("is false once the cooldown has elapsed", () => {
    expect(installBannerDismissed(storageWith(String(now - 8 * 24 * 60 * 60 * 1000)), now)).toBe(false);
  });

  it("is false for a malformed timestamp", () => {
    expect(installBannerDismissed(storageWith("not-a-number"), now)).toBe(false);
  });
});

