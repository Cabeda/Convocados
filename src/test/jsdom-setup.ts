// jsdom environment setup — runs once per test file in the jsdom project.
// Mirrors the matchMedia mock from src/test/component-setup.ts so that tests
// in the components/ directory (which previously did not have a global setup)
// can render MUI components without the missing-API error.

import { afterAll, afterEach } from "vitest";
import { registerAuthSessionFlushHook } from "./auth-teardown";

// better-auth mounts its session atom from a nanostores lifecycle timer, and
// the atom itself defers `fetchSessionOnMount` by another 0ms timer. When a test
// file finishes before those flush, the mount runs after Vitest has torn down
// jsdom. Flushing a few macrotasks after each test lets the mount run while
// `window` still exists.
afterEach(async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
});

// GH #1209: the *unmount* is the dangerous half. nanostores defers the
// session atom's unmount destroys by STORE_UNMOUNT_DELAY (1000ms) after the
// last unsubscribe — see nanostores lifecycle `off()`. One destroy is
// better-auth's `refreshManager.cleanup()`, whose `cleanupBroadcastSetup`
// closure calls bare `window.removeEventListener` with no `typeof window`
// guard. The test file almost always finishes inside that 1s window, so
// Vitest tore jsdom down first and the deferred destroy threw
// "window is not defined" — an unhandled error that failed the whole shard
// with every test green (SeasonListPage, SeasonConditionalStates, others).
// Out-wait the delay in a file-level afterAll, which runs before environment
// teardown, so the destroys land while `window` still exists.
afterAll(registerAuthSessionFlushHook());

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
