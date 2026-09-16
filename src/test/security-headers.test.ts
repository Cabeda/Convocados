import { describe, it, expect } from "vitest";
import { SECURITY_HEADERS, applySecurityHeaders } from "~/lib/securityHeaders";

describe("SECURITY_HEADERS", () => {
  it("covers the headers that were missing on prerendered pages", () => {
    expect(SECURITY_HEADERS).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "SAMEORIGIN",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": expect.any(String),
      "Strict-Transport-Security": expect.stringContaining("max-age="),
      "Content-Security-Policy": expect.any(String),
    });
  });

  it("blocks external framing via the CSP", () => {
    expect(SECURITY_HEADERS["Content-Security-Policy"]).toContain("frame-ancestors 'self'");
  });
});

describe("applySecurityHeaders", () => {
  it("adds every header to a plain response", () => {
    const response = applySecurityHeaders(new Response("hi"));
    for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
      expect(response.headers.get(key)).toBe(value);
    }
  });

  it("does not clobber a header the handler already set", () => {
    const response = applySecurityHeaders(
      new Response("hi", { headers: { "X-Frame-Options": "DENY" } }),
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("preserves status and Location on a redirect", () => {
    const redirect = Response.redirect("https://convocados.cabeda.dev/dashboard", 302);
    const response = applySecurityHeaders(redirect);
    expect(response.status).toBe(302);
    expect(response.headers.get("Location")).toBe("https://convocados.cabeda.dev/dashboard");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
