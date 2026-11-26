import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const apiRequest = vi.fn();
vi.mock("~/lib/api/client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
  apiFetch: vi.fn(),
  ApiError: class ApiError extends Error {},
}));

vi.mock("~/lib/auth.client", () => ({
  authClient: { signOut: vi.fn(), changePassword: vi.fn() },
  useSession: () => ({ data: null, isPending: false, refetch: vi.fn() }),
  signOut: vi.fn(),
}));

// The sections below the header fetch their own data and are irrelevant to the
// fragment scroll; mocking them keeps the test about the one behaviour.
vi.mock("~/components/NotificationSettingsSection", () => ({
  NotificationSettingsSection: () => null,
}));
vi.mock("~/components/LinkedCredentialsSection", () => ({
  LinkedCredentialsSection: () => null,
}));

import UserProfilePage from "~/components/UserProfilePage";

const profile = {
  user: { id: "u1", name: "Ana", image: null, createdAt: "2025-01-01T00:00:00.000Z" },
  isOwnProfile: true,
  owned: [],
  joined: [],
  stats: { totalGames: 0, ownedGames: 0, joinedGames: 0 },
  profileVisibility: "public",
};

const stats = {
  summary: {
    totalGames: 0,
    totalWins: 0,
    totalDraws: 0,
    totalLosses: 0,
    winRate: 0,
    avgRating: 1000,
    bestRating: 1000,
    eventsPlayed: 0,
    totalMvpAwards: 0,
    totalGoals: 0,
    totalAssists: 0,
  },
  events: [],
};

beforeEach(() => {
  window.history.replaceState(null, "", "/users/u1#payment-details");
  apiRequest.mockReset();
  apiRequest.mockImplementation((operation: string) => {
    if (operation === "GET /api/users/{id}") return Promise.resolve(profile);
    if (operation === "GET /api/users/{id}/stats") return Promise.resolve(stats);
    return Promise.resolve({});
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

describe("UserProfilePage #payment-details deep link (GH #1722)", () => {
  it("scrolls the payment card into view once the client-only page mounts", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;

    render(<UserProfilePage userId="u1" />);

    // The payment card is below the fold and only exists after the profile
    // fetch resolves, so the browser's own fragment scroll has already run.
    await waitFor(() => expect(document.getElementById("payment-details")).not.toBeNull());
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());

    expect((scrollIntoView.mock.instances[0] as unknown as Element).id).toBe("payment-details");
  });
});
