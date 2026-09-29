// jsdom environment setup — runs once per test file in the jsdom project.
// Mirrors the matchMedia mock from src/test/component-setup.ts so that tests
// in the components/ directory (which previously did not have a global setup)
// can render MUI components without the missing-API error.

import { afterEach } from "vitest";

// better-auth mounts its session atom from a nanostores lifecycle timer, and
// the atom itself defers `fetchSessionOnMount` by another 0ms timer. When a test
// file finishes before those flush, the mount — and the cleanup it registers —
// run after Vitest has torn down jsdom, and `window.removeEventListener` in
// better-auth's `cleanupBroadcastSetup` throws "window is not defined". Vitest
// reports that as an unhandled error and fails the entire shard with every test
// green, which is how this reached CI three times across different component
// files. Flushing a few macrotasks after each test lets the mount and its
// cleanup run while `window` still exists, so the environment teardown is the
// only thing left standing.
afterEach(async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});

if (typeof window !== "undefined") {
  if (!window.matchMedia) {
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

  // jsdom >=30.1.0 exposes the Document as the `relatedTarget` of a focus
  // event when focus moves out of the document. MUI's FocusTrap stores that
  // value and later calls `.focus()` to restore it, which throws
  // `nodeToRestore.current.focus is not a function`. There is no focus to
  // restore to a Document, so a no-op shim keeps the restore path harmless.
  if (typeof Document !== "undefined" && typeof (Document.prototype as any).focus !== "function") {
    Object.defineProperty(Document.prototype, "focus", {
      configurable: true,
      writable: true,
      value: () => {},
    });
  }

  // Mock __APP_VERSION__ used by ResponsiveLayout
  (globalThis as any).__APP_VERSION__ = "0.0.0-test";
}
