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

  it("keeps the Google sign-in button on iOS PWA (popup-based flow handles cross-origin nav)", () => {
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.getByRole("button", { name: /signInWithGoogle/ })).toBeInTheDocument();
  });

  it("keeps the Google sign-in button on desktop browsers", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    expect(screen.getByRole("button", { name: /signInWithGoogle/ })).toBeInTheDocument();
  });
});

describe("SignInPage — Google sign-in popup flow on iOS PWA", () => {
  it("on iOS PWA, clicking Google sign-in calls signIn.social with disableRedirect", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");

    await user.click(screen.getByRole("button", { name: /signInWithGoogle/ }));

    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/events/abc",
      disableRedirect: true,
    });
  });

  it("on iOS PWA, opens a popup window with the returned OAuth URL", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(isIosPwa).mockReturnValue(true);
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    mockSignInSocial.mockResolvedValue({ redirect: false, url: "https://accounts.google.com/o/oauth2/v2/auth?state=abc" });

    await user.click(screen.getByRole("button", { name: /signInWithGoogle/ }));

    expect(openSpy).toHaveBeenCalledWith(
      "https://accounts.google.com/o/oauth2/v2/auth?state=abc",
      "google-oauth",
      expect.stringMatching(/width|height/),
    );
    openSpy.mockRestore();
  });

  it("on iOS PWA, reloads the page when the popup closes (so the session cookie is picked up)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const reloadSpy = vi.fn();
    // Stub window.location.reload by replacing the Location object (jsdom's
    // Location is non-writable, so we replace the whole property).
    const realLocation = window.location;
    const fakeLocation = { ...realLocation, reload: reloadSpy } as unknown as Location;
    Object.defineProperty(window, "location", { value: fakeLocation, writable: true, configurable: true });
    // Popup that reports as closed on the next .closed check
    const fakePopup = { closed: false, close: vi.fn() } as unknown as Window;
    const openSpy = vi.spyOn(window, "open").mockReturnValue(fakePopup);
    try {
      vi.mocked(isIosPwa).mockReturnValue(true);
      renderAtUrl("/auth/signin?callbackURL=/events/abc");
      mockSignInSocial.mockResolvedValue({ redirect: false, url: "https://google.test" });

      await user.click(screen.getByRole("button", { name: /signInWithGoogle/ }));

      // Simulate the popup closing after the OAuth round-trip
      await new Promise((r) => setTimeout(r, 10));
      (fakePopup as { closed: boolean }).closed = true;
      await new Promise((r) => setTimeout(r, 400)); // poll interval is ~300ms

      expect(reloadSpy).toHaveBeenCalled();
    } finally {
      openSpy.mockRestore();
      Object.defineProperty(window, "location", { value: realLocation, writable: true, configurable: true });
    }
  });

  it("on desktop, clicking Google sign-in does NOT open a popup (default redirect flow)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    vi.mocked(isIosPwa).mockReturnValue(false);
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
});
