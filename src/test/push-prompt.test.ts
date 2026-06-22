import { describe, it, expect } from "vitest";
import {
  isIos,
  isStandalone,
  resolveIosHelpLink,
  pickActiveBanner,
  type PermissionState,
  type BannerContext,
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

// ── pickActiveBanner — single-source-of-truth resolver ──────────────────────

function ctx(over: Partial<BannerContext> = {}): BannerContext {
  return {
    isStandalone: false,
    isIos: false,
    permission: "default" as PermissionState,
    installDismissed: false,
    pushPromptVisible: true,
    ...over,
  };
}

describe("pickActiveBanner", () => {
  describe("both suppressed when standalone", () => {
    it("returns 'none' when app is installed (PWA)", () => {
      expect(pickActiveBanner(ctx({ isStandalone: true }))).toBe("none");
    });
  });

  describe("permission already granted", () => {
    it("hides push banner, keeps install banner as install path", () => {
      // On desktop: install banner still useful for "open as app" UX
      // On iOS: install banner useless (already granted means user is on this device, possibly installed)
      expect(pickActiveBanner(ctx({ permission: "granted", isIos: false }))).toBe("install");
      expect(pickActiveBanner(ctx({ permission: "granted", isIos: true }))).toBe("none");
    });
  });

  describe("permission denied", () => {
    it("hides push banner (denied = terminal), keeps install banner", () => {
      expect(pickActiveBanner(ctx({ permission: "denied" }))).toBe("install");
    });
    it("hides both on iOS — install doesn't help a denied permission", () => {
      // Actually on iOS PWA install can change permission context, so still show install
      // But if standalone + denied, no banners
      expect(pickActiveBanner(ctx({ permission: "denied", isIos: true, isStandalone: true }))).toBe("none");
    });
  });

  describe("permission default", () => {
    it("prefers push banner on desktop", () => {
      expect(pickActiveBanner(ctx({ permission: "default", isIos: false }))).toBe("push");
    });
    it("prefers install banner on iOS (push needs PWA install first)", () => {
      expect(pickActiveBanner(ctx({ permission: "default", isIos: true }))).toBe("install");
    });
    it("falls back to install when push prompt was hidden by internal logic", () => {
      expect(pickActiveBanner(ctx({ permission: "default", pushPromptVisible: false }))).toBe("install");
    });
  });

  describe("dismissals", () => {
    it("install dismissed → can still show push", () => {
      expect(pickActiveBanner(ctx({ permission: "default", installDismissed: true }))).toBe("push");
    });
    it("push dismissed (via internal flag) → can still show install", () => {
      expect(pickActiveBanner(ctx({ permission: "default", pushPromptVisible: false, installDismissed: false }))).toBe("install");
    });
    it("both dismissed → none", () => {
      expect(pickActiveBanner(ctx({
        permission: "default",
        installDismissed: true,
        pushPromptVisible: false,
      }))).toBe("none");
    });
  });
});
