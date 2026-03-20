import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Cleanup DOM after each test
afterEach(() => {
  cleanup();
});

// Mock __APP_VERSION__ global used by ResponsiveLayout
(globalThis as any).__APP_VERSION__ = "0.0.0-test";

// Mock matchMedia (needed by MUI)
if (typeof window !== "undefined" && !window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// Mock navigator.serviceWorker
if (typeof navigator !== "undefined") {
  try {
    Object.defineProperty(navigator, "serviceWorker", {
      value: undefined,
      configurable: true,
      writable: true,
    });
  } catch { /* already defined */ }
}

// Mock navigator.geolocation
if (typeof navigator !== "undefined" && !navigator.geolocation) {
  try {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (_success: any, error: any) => error?.({ code: 1, message: "denied" }),
        watchPosition: () => 0,
        clearWatch: () => {},
      },
      configurable: true,
    });
  } catch { /* already defined */ }
}
