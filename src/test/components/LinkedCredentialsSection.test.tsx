import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useMemo } from "react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

vi.mock("~/lib/auth.client", () => ({
  authClient: {
    linkSocial: vi.fn().mockResolvedValue({ data: { redirect: true }, error: null }),
    signOut: vi.fn(),
  },
}));

vi.mock("~/lib/useT", () => ({
  useT: () => {
    const t = (key: string, params?: Record<string, string | number>) => {
      const dict: Record<string, string> = {
        linkedSignIns: "Sign-in methods",
        linkedSignInsDesc: "Password and social accounts you can use to sign in.",
        credentialPassword: "Password",
        credentialGoogle: "Google",
        linkGoogleBtn: "Link Google",
        unlinkCredentialBtn: "Remove",
        onlyCredentialHint: "This is your only sign-in method.",
        credentialUnlinked: "Sign-in method removed.",
        credentialUnlinkError: "Could not remove sign-in method.",
        credentialLoadError: "Could not load sign-in methods.",
        mergeConfirmTitle: "Merge accounts?",
        mergeConfirmDesc:
          "This Google sign-in belongs to another Convocados account ({email}, created {date}).",
        mergeConfirmBtn: "Merge accounts",
        mergeCancelBtn: "Cancel",
        mergeSuccess: "Accounts merged.",
        linkGoogleSuccess: "Google linked to your account.",
        linkGoogleError: "Could not link Google. Try again.",
      };
      let s = dict[key] ?? key;
      if (params) {
        for (const [k, v] of Object.entries(params)) s = s.replaceAll(`{${k}}`, String(v));
      }
      return s;
    };
    return useMemo(() => t, []);
  },
}));

import { LinkedCredentialsSection } from "~/components/LinkedCredentialsSection";
import { authClient } from "~/lib/auth.client";

function credentialsResponse(credentials: unknown[]) {
  return {
    ok: true,
    json: async () => ({ credentials }),
  };
}

function pendingMergeResponse(pending: unknown) {
  return {
    ok: true,
    json: async () => ({ pendingMerge: pending }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/users/u1");
});

afterEach(() => {
  cleanup();
});

describe("LinkedCredentialsSection", () => {
  it("lists password and google credentials with remove buttons when more than one", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("pending-merge")) return Promise.resolve(pendingMergeResponse(null));
      return Promise.resolve(
        credentialsResponse([
          { id: "a1", providerId: "credential", accountId: "u1", issuer: "local:credential", createdAt: "2026-01-01T00:00:00Z" },
          { id: "a2", providerId: "google", accountId: "sub1", issuer: "https://accounts.google.com", createdAt: "2026-01-02T00:00:00Z" },
        ]),
      );
    });

    render(<LinkedCredentialsSection profilePath="/users/u1" />);
    await waitFor(() => expect(screen.getByText("Password")).toBeInTheDocument());
    expect(screen.getByText("Google")).toBeInTheDocument();
    expect(screen.getAllByText("Remove")).toHaveLength(2);
    expect(screen.queryByText("Link Google")).not.toBeInTheDocument();
  });

  it("shows only-credential hint and hides remove when sole credential", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("pending-merge")) return Promise.resolve(pendingMergeResponse(null));
      return Promise.resolve(
        credentialsResponse([
          { id: "a1", providerId: "credential", accountId: "u1", issuer: "local:credential", createdAt: "2026-01-01T00:00:00Z" },
        ]),
      );
    });

    render(<LinkedCredentialsSection profilePath="/users/u1" />);
    await waitFor(() => expect(screen.getByText("This is your only sign-in method.")).toBeInTheDocument());
    expect(screen.queryByText("Remove")).not.toBeInTheDocument();
    expect(screen.getByText("Link Google")).toBeInTheDocument();
  });

  it("opens merge interstitial when a pending merge exists", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("pending-merge")) {
        return Promise.resolve(
          pendingMergeResponse({
            absorbedUserId: "u2",
            absorbedEmail: "absorbed@gmail.com",
            absorbedName: "Absorbed",
            absorbedCreatedAt: "2026-01-01T00:00:00Z",
            absorbedEventCount: 2,
            providerId: "google",
            accountId: "sub-conflict",
          }),
        );
      }
      return Promise.resolve(
        credentialsResponse([
          { id: "a1", providerId: "credential", accountId: "u1", issuer: "local:credential", createdAt: "2026-01-01T00:00:00Z" },
        ]),
      );
    });

    render(<LinkedCredentialsSection profilePath="/users/u1" />);
    await waitFor(() =>
      expect(screen.getByText("Merge accounts?")).toBeInTheDocument(),
    );
    expect(screen.getByText(/absorbed@gmail\.com/)).toBeInTheDocument();
    expect(screen.getByText("Merge accounts")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("calls linkSocial when Link Google is clicked", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url.includes("pending-merge")) return Promise.resolve(pendingMergeResponse(null));
      return Promise.resolve(
        credentialsResponse([
          { id: "a1", providerId: "credential", accountId: "u1", issuer: "local:credential", createdAt: "2026-01-01T00:00:00Z" },
        ]),
      );
    });

    const user = userEvent.setup();
    render(<LinkedCredentialsSection profilePath="/users/u1" />);
    await waitFor(() => expect(screen.getByText("Link Google")).toBeInTheDocument());
    await user.click(screen.getByText("Link Google"));
    await waitFor(() =>
      expect(authClient.linkSocial).toHaveBeenCalledWith(
        expect.objectContaining({ provider: "google" }),
      ),
    );
  });
});
