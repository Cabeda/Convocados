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

describe("SignInPage — iOS PWA detection", () => {
  it("does not show the iOS PWA banner on a regular desktop browser", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.queryByTestId("ios-pwa-notice")).toBeNull();
  });

  it("shows an iOS PWA notice when running in an installed PWA on iOS", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.getByTestId("ios-pwa-notice")).toBeInTheDocument();
  });

  it("the iOS PWA notice warns that Google sign-in opens Safari", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    const notice = screen.getByTestId("ios-pwa-notice");
    // The notice text should mention the iOS PWA / external browser limitation
    expect(notice.textContent).toMatch(/safari|browser|pwa/i);
  });

  it("hides the Google sign-in button on iOS PWA (it would open Safari)", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.queryByRole("button", { name: /signInWithGoogle/ })).toBeNull();
  });

  it("keeps the Google sign-in button on desktop browsers", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.getByRole("button", { name: /signInWithGoogle/ })).toBeInTheDocument();
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
});
