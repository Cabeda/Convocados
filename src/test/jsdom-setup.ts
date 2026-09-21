// jsdom environment setup — runs once per test file in the jsdom project.
// Mirrors the matchMedia mock from src/test/component-setup.ts so that tests
// in the components/ directory (which previously did not have a global setup)
// can render MUI components without the missing-API error.

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
