/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("~/lib/useT", () => ({
  useT: () => (key: string, params?: Record<string, string>) => {
    const templates: Record<string, string> = {
      oauthConsentTitle: "Authorize {appName}",
      oauthConsentDescription: "{appName} wants access to your Convocados account",
    };
    let v = templates[key] ?? key;
    for (const [k, val] of Object.entries(params ?? {})) v = v.replace(`{${k}}`, val);
    return v;
  },
}));

import OAuthConsentPage from "~/components/OAuthConsentPage";

/** The signed authorization request the AS hands to the consent page. */
const QUERY =
  "client_id=abc123&scope=openid+read%3Aevents&sig=deadbeef&response_type=code&state=xyz";

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

/** jsdom cannot navigate; replace location with a plain object we can read. */
function stubLocation() {
  delete (window as any).location;
  (window as any).location = { href: "", pathname: "/oauth/consent", search: `?${QUERY}` };
}

beforeEach(() => {
  vi.clearAllMocks();
  stubLocation();
  mockFetch.mockImplementation(async (url: string) => {
    if (String(url).includes("/oauth2/public-client")) {
      return {
        ok: true,
        json: async () => ({ client_id: "abc123", client_name: "Claude", logo_uri: null }),
      };
    }
    return {
      ok: true,
      json: async () => ({ redirect: true, url: "https://claude.ai/api/mcp/auth_callback?code=the-code" }),
    };
  });
});

afterEach(() => cleanup());

describe("OAuthConsentPage — the consent request the AS can read", () => {
  it("shows the client's name", async () => {
    render(<OAuthConsentPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Authorize Claude/ })).toBeInTheDocument());
    // The name comes from the AS, not from the client id in the URL.
    const clientCall = mockFetch.mock.calls.find((c) => String(c[0]).includes("/oauth2/public-client"));
    expect(clientCall).toBeDefined();
    expect(String(clientCall[0])).toContain("client_id=abc123");
  });

  it("posts the signed request as oauth_query, not a consent code", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<OAuthConsentPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Authorize Claude/ })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /oauthConsentAllow/ }));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find((c) => String(c[0]).includes("/oauth2/consent"));
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body.accept).toBe(true);
      expect(body.oauth_query).toBe(QUERY);
      expect(body.consent_code).toBeUndefined();
    });
  });

  it("continues to the URL the AS answers with (the code on the client's redirect)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<OAuthConsentPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Authorize Claude/ })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /oauthConsentAllow/ }));

    await waitFor(() =>
      expect((window as any).location.href).toBe("https://claude.ai/api/mcp/auth_callback?code=the-code"),
    );
  });

  it("denies with the same request and the same destination handling", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<OAuthConsentPage />);
    await waitFor(() => expect(screen.getByRole("heading", { name: /Authorize Claude/ })).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /oauthConsentDeny/ }));

    await waitFor(() => {
      const call = mockFetch.mock.calls.find((c) => String(c[0]).includes("/oauth2/consent"));
      expect(call).toBeDefined();
      const body = JSON.parse(call[1].body);
      expect(body.accept).toBe(false);
      expect(body.oauth_query).toBe(QUERY);
    });
  });
});
