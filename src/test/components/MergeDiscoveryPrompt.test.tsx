/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const mockSession = { data: { user: { id: "u1", name: "Alice" } }, isPending: false };
vi.mock("~/lib/auth.client", () => ({
  useSession: () => mockSession,
}));

import MergeDiscoveryPrompt from "~/components/MergeDiscoveryPrompt";

function mockFetch({ pending, mergeOk = true }: { pending: unknown; mergeOk?: boolean }) {
  return vi.fn().mockImplementation((url: string, _opts?: RequestInit) => {
    if (url.includes("/pending-merge")) {
      return Promise.resolve({ ok: true, json: async () => ({ pendingMerge: pending }) });
    }
    if (url.includes("/credentials/merge")) {
      return Promise.resolve({ ok: mergeOk, json: async () => (mergeOk ? { ok: true } : { error: "boom" }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

const samplePending = {
  absorbedUserId: "u-old",
  absorbedEmail: "old@example.com",
  absorbedName: "Alice (old)",
  absorbedCreatedAt: "2026-01-02T10:00:00.000Z",
  absorbedEventCount: 3,
  providerId: "google",
  accountId: "acct-1",
};

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MergeDiscoveryPrompt (GH #1128)", () => {
  it("renders nothing when there is no pending merge", async () => {
    vi.stubGlobal("fetch", mockFetch({ pending: null }));
    render(<MergeDiscoveryPrompt />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the merge dialog when a pending merge exists", async () => {
    vi.stubGlobal("fetch", mockFetch({ pending: samplePending }));
    render(<MergeDiscoveryPrompt />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
    expect(screen.getByText(/old@example.com/)).toBeInTheDocument();
  });

  it("confirms the merge against the API and closes", async () => {
    const fetchMock = mockFetch({ pending: samplePending });
    vi.stubGlobal("fetch", fetchMock);
    render(<MergeDiscoveryPrompt />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /merge/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/me/credentials/merge",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("opens the dialog when the URL carries account_already_linked_to_different_user", async () => {
    window.history.replaceState({}, "", "/dashboard?error=account_already_linked_to_different_user");
    vi.stubGlobal("fetch", mockFetch({ pending: samplePending }));
    render(<MergeDiscoveryPrompt />);
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());
  });
});
