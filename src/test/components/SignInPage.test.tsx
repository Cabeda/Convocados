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

import SignInPage from "~/components/SignInPage";

function renderAtUrl(path: string) {
  window.history.replaceState(null, "", path);
  return render(<SignInPage />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  // Default: not signed in, no pending state
  mockUseSession.mockReturnValue({ data: null, isPending: false });
  mockSignInEmail.mockResolvedValue({ error: null });
  mockSignInMagicLink.mockResolvedValue({ error: null });
  mockSignInSocial.mockResolvedValue({ redirect: true, url: "https://google.test" });
});

describe("SignInPage — form guard against pre-hydration GET submit", () => {
  it("renders a <form> with explicit method='post' (not the default 'get')", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    const form = document.querySelector("form");
    expect(form).toBeInTheDocument();
    expect(form?.getAttribute("method")?.toLowerCase()).toBe("post");
  });

  it("does not leak the current URL as the form action (password would otherwise be appended to the signin URL on native submit)", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    const form = document.querySelector("form");
    const action = form?.getAttribute("action") ?? "";
    // action must not be the current page URL (which would put ?email=...&password=... in the query string)
    expect(action).not.toContain("/auth/signin");
    expect(action).not.toContain("callbackURL=");
  });
});

describe("SignInPage — postLoginURL computation", () => {
  it("uses the callbackURL when present (not the /dashboard default)", () => {
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    // The form's no-op action should resolve back to itself or a no-op, never to /dashboard
    // The actual postLoginURL is computed inside the component; we can inspect the rendered
    // <a href="/auth/signup?callbackURL=..."> to confirm the callbackURL is propagated
    const signupLink = screen.getByRole("link", { name: /signUp/ });
    expect(signupLink.getAttribute("href")).toContain("callbackURL=%2Fevents%2Fabc");
  });

  it("falls back to a /-derived dashboard default when callbackURL is missing", () => {
    renderAtUrl("/auth/signin");
    const signupLink = screen.getByRole("link", { name: /signUp/ });
    // /auth/signin without callbackURL → default is "/" → propagated as-is
    expect(signupLink.getAttribute("href")).toContain("callbackURL=%2F");
  });
});

describe("SignInPage — warn log when callbackURL is missing", () => {
  it("logs a warn when the user lands on /auth/signin without a callbackURL", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderAtUrl("/auth/signin");
    expect(warnSpy).toHaveBeenCalled();
    const warnCall = warnSpy.mock.calls.find((c) =>
      String(c[0] ?? "").includes("callbackURL"),
    );
    expect(warnCall).toBeDefined();
    warnSpy.mockRestore();
  });

  it("does not log a warn when the callbackURL is present", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderAtUrl("/auth/signin?callbackURL=/events/abc");
    const warnCall = warnSpy.mock.calls.find((c) =>
      String(c[0] ?? "").includes("callbackURL"),
    );
    expect(warnCall).toBeUndefined();
    warnSpy.mockRestore();
  });
});

describe("SignInPage — Google sign-in forwards callbackURL", () => {
  it("calls signIn.social with the callbackURL from the URL", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    renderAtUrl("/auth/signin?callbackURL=/events/abc");

    const googleButton = screen.getByRole("button", { name: /signInWithGoogle/ });
    await user.click(googleButton);

    expect(mockSignInSocial).toHaveBeenCalledWith({
      provider: "google",
      callbackURL: "/events/abc",
    });
  });
});
