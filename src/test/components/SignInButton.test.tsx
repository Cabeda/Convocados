/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, afterEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("~/lib/auth.client", () => ({
  signIn: {
    email: vi.fn().mockResolvedValue({ error: null }),
    magicLink: vi.fn().mockResolvedValue({ error: null }),
    social: vi.fn().mockResolvedValue({ redirect: true, url: "https://google.test" }),
  },
}));

vi.mock("~/lib/useT", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en", setLocale: () => {}, t: (key: string) => key }),
}));

import { SignInButton } from "~/components/SignInButton";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SignInButton", () => {
  it("renders a button, never a link that navigates to /auth/signin", () => {
    render(<SignInButton callbackURL="/events/abc">Sign in to join</SignInButton>);
    const button = screen.getByRole("button", { name: "Sign in to join" });
    expect(button).toBeInTheDocument();
    expect(button.closest("a")).toBeNull();
    expect(button).not.toHaveAttribute("href");
  });

  it("opens the in-place sign-in modal on click", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    render(<SignInButton callbackURL="/events/abc">Sign in to join</SignInButton>);

    expect(screen.queryByTestId("google-signin")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Sign in to join" }));
    expect(screen.getByTestId("google-signin")).toBeInTheDocument();
  });
});
