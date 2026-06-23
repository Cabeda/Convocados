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

describe("SignInPage — iOS PWA auth options", () => {
  it("shows the Google sign-in button on desktop browsers", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.getByRole("button", { name: /signInWithGoogle/ })).toBeInTheDocument();
  });

  it("hides the Google sign-in button on iOS PWA (cookie jar isolation makes it non-functional)", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.queryByRole("button", { name: /signInWithGoogle/ })).toBeNull();
  });

  it("hides the Google sign-in button on iOS PWA even without callbackURL", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin");
    expect(screen.queryByRole("button", { name: /signInWithGoogle/ })).toBeNull();
  });

  it("hides the magic link tab on iOS PWA (magic link email opens Safari, same jar problem)", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    // The "Sign in with Email" tab (magic link) should not be present
    expect(screen.queryByRole("tab", { name: /signInWithEmail/ })).toBeNull();
  });

  it("shows the password tab on iOS PWA (same-origin form submit works)", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    // The iOS PWA password form should be present
    expect(screen.getByTestId("ios-pwa-password-form")).toBeInTheDocument();
    // The Tabs bar should not be present on iOS PWA
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("does NOT show the misleading popup notice on iOS PWA (the user reported this was confusing)", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.queryByTestId("ios-pwa-notice")).toBeNull();
  });

  it("does NOT show the misleading popup notice on desktop either", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.queryByTestId("ios-pwa-notice")).toBeNull();
  });
});

describe("SignInPage — Google sign-in default redirect flow", () => {
  it("on desktop, clicking Google sign-in calls signIn.social with the callbackURL", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderAtUrl("/auth/signin?callbackURL=/events/abc");

    await user.click(screen.getByRole("button", { name: /signInWithGoogle/ }));

    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/events/abc",
    });
  });

  it("on desktop, does not open a popup window (default redirect flow)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");

    await user.click(screen.getByRole("button", { name: /signInWithGoogle/ }));

    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });
});

describe("SignInPage — post-auth destination fallback", () => {
  it("includes a 'where do you want to go?' fallback UI when callbackURL is missing after signin", () => {
    // This addresses the user report: "I'm sent to the main page instead of the event"
    // When callbackURL is missing, the user should see a picker, not be silently
    // redirected to /dashboard.
    renderAtUrl("/auth/signin");
    // After signin without callbackURL, the page should provide fallback links
    // (Dashboard + Public Games) instead of just auto-redirecting.
    const fallback = screen.getByTestId("post-login-fallback");
    expect(fallback).toBeInTheDocument();
    expect(fallback.querySelector("a[href='/dashboard']")).toBeTruthy();
    expect(fallback.querySelector("a[href='/public']")).toBeTruthy();
  });

  it("does NOT show the fallback when callbackURL is present (the redirect will go to callbackURL)", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    // The fallback is for the "no destination" case; with a callbackURL,
    // the redirect will handle it.
    expect(screen.queryByTestId("post-login-fallback")).toBeNull();
  });

  it("shows the fallback on iOS PWA too (the picker is auth-method-agnostic)", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin");
    expect(screen.getByTestId("post-login-fallback")).toBeInTheDocument();
  });
});
