import { describe, it, expect } from "vitest";
import { sanitizeCallbackUrl } from "~/lib/safeRedirect";

const BASE = "https://convocados.cabeda.dev";
const FALLBACK = "/";

/** Call the helper with a pinned base so the test is environment-independent. */
function sanitize(raw: string | null | undefined, fallback = FALLBACK) {
  return sanitizeCallbackUrl(raw, { base: BASE, fallback });
}

describe("sanitizeCallbackUrl", () => {
  describe("keeps same-origin relative destinations", () => {
    it("keeps a simple relative path", () => {
      expect(sanitize("/dashboard")).toBe("/dashboard");
    });

    it("keeps a path with a query string", () => {
      expect(sanitize("/events/abc?tab=teams")).toBe("/events/abc?tab=teams");
    });

    it("keeps a path with a hash", () => {
      expect(sanitize("/events/abc#roster")).toBe("/events/abc#roster");
    });

    it("normalizes an absolute same-origin URL to a path", () => {
      expect(sanitize(`${BASE}/dashboard`)).toBe("/dashboard");
    });

    it("normalizes a bare query to the root path", () => {
      expect(sanitize("?tab=1")).toBe("/?tab=1");
    });
  });

  describe("rejects cross-origin destinations", () => {
    it("rejects a protocol-relative URL", () => {
      expect(sanitize("//evil.com")).toBe(FALLBACK);
    });

    it("rejects an absolute https URL", () => {
      expect(sanitize("https://evil.com/steal")).toBe(FALLBACK);
    });

    it("rejects an absolute http URL", () => {
      expect(sanitize("http://evil.com")).toBe(FALLBACK);
    });

    // Regression: the WHATWG URL parser treats "\" as "/" for special schemes,
    // so "/\evil.com" resolves to the protocol-relative "//evil.com". The old
    // guard (startsWith("/") && !startsWith("//")) let this through.
    it("rejects a backslash-prefixed path", () => {
      expect(sanitize("/\\evil.com")).toBe(FALLBACK);
    });

    it("rejects a mixed backslash/slash path", () => {
      expect(sanitize("/\\/evil.com")).toBe(FALLBACK);
    });

    it("rejects a double-backslash path", () => {
      expect(sanitize("\\\\evil.com")).toBe(FALLBACK);
    });

    it("rejects a javascript: URL", () => {
      expect(sanitize("javascript:alert(1)")).toBe(FALLBACK);
    });

    it("rejects a data: URL", () => {
      expect(sanitize("data:text/html,<script>alert(1)</script>")).toBe(FALLBACK);
    });

    it("rejects a same-host different-port origin", () => {
      expect(sanitize(`${BASE}:8443/x`)).toBe(FALLBACK);
    });

    it("rejects a subdomain", () => {
      expect(sanitize("https://evil.convocados.cabeda.dev/x")).toBe(FALLBACK);
    });

    it("rejects a scheme downgrade to the same host", () => {
      expect(sanitize("http://convocados.cabeda.dev/x")).toBe(FALLBACK);
    });
  });

  describe("fallback handling", () => {
    it("falls back for null", () => {
      expect(sanitize(null)).toBe(FALLBACK);
    });

    it("falls back for undefined", () => {
      expect(sanitize(undefined)).toBe(FALLBACK);
    });

    it("falls back for an empty string", () => {
      expect(sanitize("")).toBe(FALLBACK);
    });

    it("honours a safe custom fallback", () => {
      expect(sanitize("https://evil.com", "/dashboard")).toBe("/dashboard");
    });

    it("never returns a cross-origin fallback", () => {
      expect(sanitize("//evil.com", "//evil.com")).toBe(FALLBACK);
    });
  });
});
