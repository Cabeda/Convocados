import { describe, it, expect, afterEach, vi } from "vitest";
import { isIosPwa, isIosSafariStandalone, isIos } from "~/lib/pwaDetect";

/**
 * pwaDetect is intentionally client-only (uses window + navigator). These
 * tests stub window and navigator via vi.stubGlobal so they can run in
 * the node vitest environment where window may not exist.
 */

let originalNavigator: PropertyDescriptor | undefined;
let originalWindow: PropertyDescriptor | undefined;

function stubEnv(ua: string, standalone: boolean, innerWidth = 1024) {
  // jsdom provides window. We re-define both to ensure they're mutable.
  originalNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const fakeWindow = {
    innerWidth,
  };
  Object.defineProperty(globalThis, "window", {
    value: fakeWindow,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "navigator", {
    value: { userAgent: ua, standalone },
    writable: true,
    configurable: true,
  });
}

function restoreEnv() {
  if (originalNavigator) Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete (globalThis as { navigator?: unknown }).navigator;
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else delete (globalThis as { window?: unknown }).window;
}

describe("pwaDetect", () => {
  afterEach(() => {
    restoreEnv();
    vi.restoreAllMocks();
  });

  it("isIosPwa returns true on iOS with standalone=true", () => {
    stubEnv("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", true);
    expect(isIosPwa()).toBe(true);
  });

  it("isIosPwa returns false on iOS with standalone=false", () => {
    stubEnv("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", false);
    expect(isIosPwa()).toBe(false);
  });

  it("isIosPwa returns false on Android even with standalone=true", () => {
    stubEnv("Mozilla/5.0 (Linux; Android 14)", true);
    expect(isIosPwa()).toBe(false);
  });

  it("isIosPwa returns false on desktop Chrome", () => {
    stubEnv("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36", false);
    expect(isIosPwa()).toBe(false);
  });

  it("isIosSafariStandalone returns true on iOS Safari (standalone=false, narrow viewport)", () => {
    stubEnv("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", false, 375);
    expect(isIosSafariStandalone()).toBe(true);
  });

  it("isIos returns true on any iOS UA regardless of standalone", () => {
    stubEnv("Mozilla/5.0 (iPad; CPU OS 17_0)", false);
    expect(isIos()).toBe(true);
  });

  it("isIos returns false on non-iOS", () => {
    stubEnv("Mozilla/5.0 (Windows NT 10.0)", false);
    expect(isIos()).toBe(false);
  });
});
