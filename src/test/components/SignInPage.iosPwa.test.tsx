/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

// Mock auth.client BEFORE importing the component
const mockSignInEmail = vi.fn();
const mockSignInMagicLink = vi.fn();
const mockSignInSocial = vi.fn();
const mockUseSession = vi.fn();

vi.mock("~/lib/auth.client", () => ({
  signIn: {
    email: (...args: unknown[]) => mockSignInEmail(...args),
    magicLink: (...args: unknown[]) => mockSignInMagicLink(...args),
    social: (...args: unknown[]) => mockSignInSocial(...args),
  },
  useSession: () => mockUseSession(),
}));

vi.mock("~/lib/i18n", () => ({
  detectLocale: () => "en",
}));

vi.mock("~/lib/useT", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en", setLocale: () => {}, t: (key: string) => key }),
}));

vi.mock("~/lib/pwaDetect", () => ({
  isIosPwa: vi.fn(() => false),
  isIosSafariStandalone: vi.fn(() => false),
}));

import SignInPage from "~/components/SignInPage";
import { isIosPwa, isIosSafariStandalone } from "~/lib/pwaDetect";

function renderAtUrl(path: string) {
  window.history.replaceState(null, "", path);
  return render(<SignInPage />);
}

afterEach(() => {
  cleanup();
  document.querySelectorAll('script[src="https://accounts.google.com/gsi/client"]').forEach((script) => script.remove());
  Reflect.deleteProperty(globalThis, "google");
  vi.clearAllMocks();
});

beforeEach(() => {
  mockUseSession.mockReturnValue({ data: null, isPending: false });
  mockSignInEmail.mockResolvedValue({ error: null });
  mockSignInMagicLink.mockResolvedValue({ error: null });
  mockSignInSocial.mockResolvedValue({ redirect: true, url: "https://google.test" });
  vi.mocked(isIosPwa).mockReturnValue(false);
  vi.mocked(isIosSafariStandalone).mockReturnValue(false);
});

describe("SignInPage — iOS PWA Google sign-in", () => {
  it("renders a GIS button container on iOS PWA", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.getByTestId("google-gis-signin")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /signInWithGoogle/ })).toBeNull();
  });

  it("keeps the normal Google redirect button on desktop browsers", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.getByRole("button", { name: /signInWithGoogle/ })).toBeInTheDocument();
    expect(screen.queryByTestId("google-gis-signin")).toBeNull();
  });

  it("initializes GIS and exchanges the returned credential for a same-origin session", async () => {
    const googleId = {
      initialize: vi.fn(),
      renderButton: vi.fn(),
    };
    vi.stubGlobal("google", { accounts: { id: googleId } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ clientId: "test-client-id" }),
    }));
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");

    await vi.waitFor(() => expect(googleId.initialize).toHaveBeenCalled());
    expect(googleId.initialize).toHaveBeenCalledWith(expect.objectContaining({
      client_id: "test-client-id",
      callback: expect.any(Function),
    }));
    expect(googleId.renderButton).toHaveBeenCalledWith(
      screen.getByTestId("google-gis-signin"),
      expect.any(Object),
    );

    const [[{ callback }]] = googleId.initialize.mock.calls;
    await callback({ credential: "google-id-token" });

    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "google",
      idToken: { token: "google-id-token" },
    });
  });

  it("loads the GIS script when it is not already present", async () => {
    vi.stubGlobal("google", undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ clientId: "test-client-id" }),
    }));
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");

    await vi.waitFor(() => {
      expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeInTheDocument();
    });

    const googleId = {
      initialize: vi.fn(),
      renderButton: vi.fn(),
    };
    vi.stubGlobal("google", { accounts: { id: googleId } });
    document.querySelector('script[src="https://accounts.google.com/gsi/client"]')
      ?.dispatchEvent(new Event("load"));

    await vi.waitFor(() => expect(googleId.initialize).toHaveBeenCalled());
  });

  it("removes a failed GIS script so a later mount can retry", async () => {
    vi.stubGlobal("google", undefined);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ clientId: "test-client-id" }),
    }));
    vi.mocked(isIosPwa).mockReturnValue(true);
    const firstRender = renderAtUrl("/auth/signin?callbackURL=/events/abc");

    await vi.waitFor(() => {
      expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeInTheDocument();
    });
    document.querySelector('script[src="https://accounts.google.com/gsi/client"]')
      ?.dispatchEvent(new Event("error"));
    await vi.waitFor(() => {
      expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeNull();
    });

    firstRender.unmount();
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    await vi.waitFor(() => {
      expect(document.querySelector('script[src="https://accounts.google.com/gsi/client"]')).toBeInTheDocument();
    });
  });

  it("leaves email/password available when GIS configuration cannot be loaded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ clientId: "" }),
    }));
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");

    await vi.waitFor(() => expect(screen.getByRole("tab", { name: /signInWithPassword/ })).toBeInTheDocument());
    expect(screen.getByRole("tab", { name: /signInWithEmail/ })).toBeInTheDocument();
  });
});

describe("SignInPage — post-auth destination fallback", () => {
  it("includes a 'where do you want to go?' fallback UI when callbackURL is missing after signin", () => {
    renderAtUrl("/auth/signin");
    const fallback = screen.getByTestId("post-login-fallback");
    expect(fallback).toBeInTheDocument();
    expect(fallback.querySelector("a[href='/dashboard']")).toBeTruthy();
    expect(fallback.querySelector("a[href='/public']")).toBeTruthy();
  });

  it("does NOT show the fallback when callbackURL is present (the redirect will go to callbackURL)", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.queryByTestId("post-login-fallback")).toBeNull();
  });
});
