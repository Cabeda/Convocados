import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
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
  it("keeps the Google sign-in button on iOS PWA", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.getByRole("button", { name: /signInWithGoogle/ })).toBeInTheDocument();
  });

  it("keeps the Google sign-in button on desktop browsers", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.getByRole("button", { name: /signInWithGoogle/ })).toBeInTheDocument();
  });

  it("does NOT show the old misleading iOS PWA popup notice", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.queryByTestId("ios-pwa-notice")).toBeNull();
  });

  it("on iOS PWA, clicking Google uses the plain top-level redirect flow (no disableRedirect, no popup)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");

    await user.click(screen.getByRole("button", { name: /signInWithGoogle/ }));

    // Same path as web/Android: redirect flow, no popup, no disableRedirect.
    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/events/abc",
    });
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("on desktop, clicking Google uses the same redirect flow (no popup)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(isIosPwa).mockReturnValue(false);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");

    await user.click(screen.getByRole("button", { name: /signInWithGoogle/ }));

    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/events/abc",
    });
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
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
