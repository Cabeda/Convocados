import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockSignInEmail = vi.fn();
const mockSignInMagicLink = vi.fn();
const mockSignInSocial = vi.fn();

vi.mock("~/lib/auth.client", () => ({
  signIn: {
    email: (...args: unknown[]) => mockSignInEmail(...args),
    magicLink: (...args: unknown[]) => mockSignInMagicLink(...args),
    social: (...args: unknown[]) => mockSignInSocial(...args),
  },
}));

vi.mock("~/lib/useT", () => ({
  useT: () => (key: string) => key,
  useLocale: () => ({ locale: "en", setLocale: () => {}, t: (key: string) => key }),
}));

import { SignInModal } from "~/components/SignInModal";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockSignInEmail.mockResolvedValue({ error: null });
  mockSignInMagicLink.mockResolvedValue({ error: null });
  mockSignInSocial.mockResolvedValue({ redirect: true, url: "https://google.test" });
});

describe("SignInModal", () => {
  it("does not render its content when closed", () => {
    render(<SignInModal open={false} onClose={() => {}} callbackURL="/events/abc" onSuccess={() => {}} />);
    expect(screen.queryByTestId("google-signin")).toBeNull();
  });

  it("renders the shared sign-in form when open", () => {
    render(<SignInModal open onClose={() => {}} callbackURL="/events/abc" onSuccess={() => {}} />);
    expect(screen.getByTestId("google-signin")).toBeInTheDocument();
  });

  it("Google sign-in uses the plain redirect flow with the given callbackURL (returns to the same page)", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(<SignInModal open onClose={() => {}} callbackURL="/events/abc" onSuccess={() => {}} />);

    await user.click(screen.getByTestId("google-signin"));

    expect(mockSignInSocial).toHaveBeenCalledWith({ provider: "google", callbackURL: "/events/abc" });
    expect(openSpy).not.toHaveBeenCalled();
    openSpy.mockRestore();
  });

  it("on successful email/password sign-in, calls onSuccess and does NOT navigate", async () => {
    const { default: userEvent } = await import("@testing-library/user-event");
    const user = userEvent.setup();
    const onSuccess = vi.fn();
    render(<SignInModal open onClose={() => {}} callbackURL="/events/abc" onSuccess={onSuccess} />);

    // Switch to the password tab
    await user.click(screen.getByRole("tab", { name: /signInWithPassword/ }));

    const inputs = screen.getAllByRole("textbox"); // email field
    await user.type(inputs[0], "a@b.com");
    // password field is not a textbox role (type=password) — grab by label
    const pwd = document.querySelector('input[type="password"]') as HTMLInputElement;
    await user.type(pwd, "secret");

    await user.click(screen.getByRole("button", { name: /^signIn$/ }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalled());
    expect(mockSignInEmail).toHaveBeenCalledWith({ email: "a@b.com", password: "secret" });
  });
});
