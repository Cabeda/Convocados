import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import DashboardPage from "~/components/DashboardPage";
import type { GameSummary } from "~/components/GameCard";

// Mock __APP_VERSION__
(globalThis as any).__APP_VERSION__ = "0.0.0-test";

// Mock auth.client (imported by ResponsiveLayout / DashboardPage).
// Stable identity — a fresh object per render would re-trigger the
// session-dependent load effect on every re-render.
const mockSession = { data: { user: { id: "me", name: "Test User" } }, isPending: false };
vi.mock("~/lib/auth.client", () => ({
  useSession: () => mockSession,
  signOut: vi.fn(),
}));

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const upcomingOwned: GameSummary = {
  id: "evt-owned-1",
  title: "Sunday Football",
  location: "Central Park",
  dateTime: new Date(now + 1 * DAY).toISOString(),
  timezone: "UTC",
  sport: "football-5v5",
  maxPlayers: 10,
  playerCount: 6,
};

const upcomingOwned2: GameSummary = {
  id: "evt-owned-2",
  title: "Midweek Football",
  location: "Riverside",
  dateTime: new Date(now + 2 * DAY).toISOString(),
  timezone: "UTC",
  sport: "football-5v5",
  maxPlayers: 10,
  playerCount: 4,
};

const pastOwned: GameSummary = {
  id: "evt-owned-past",
  title: "Last Week Game",
  location: "Old Field",
  dateTime: new Date(now - 1 * DAY).toISOString(),
  timezone: "UTC",
  sport: "football-5v5",
  maxPlayers: 10,
  playerCount: 8,
};

const upcomingAdmin: GameSummary = {
  id: "evt-admin-1",
  title: "Saturday Basketball",
  location: "Downtown Court",
  dateTime: new Date(now + 3 * DAY).toISOString(),
  timezone: "UTC",
  sport: "basketball",
  maxPlayers: 10,
  playerCount: 3,
};

const gamesPayload = {
  owned: [upcomingOwned, upcomingOwned2, pastOwned],
  admin: [upcomingAdmin],
  followed: [],
  archivedOwned: [],
  archivedAdmin: [],
  ownedNextCursor: null,
  ownedHasMore: false,
  followedNextCursor: null,
  followedHasMore: false,
};

const suggestionPayload = (names: string[]) => ({
  suggestions: names.map((name, i) => ({
    name,
    userId: `user-${name}`,
    image: null,
    gamesPlayed: 3 + i,
    coPlayCount: 1,
    score: 10 - i,
    invitedPending: false,
  })),
});

function buildFetch(
  suggestionsByEvent: Record<string, string[]> = {
    "evt-owned-1": ["Alice", "Bob"],
    "evt-owned-2": ["Carol"],
    "evt-admin-1": [],
  },
) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/me/games")) {
      return Promise.resolve({ ok: true, json: async () => gamesPayload });
    }
    const match = /^\/api\/events\/([^/]+)\/suggestions$/.exec(url);
    if (match) {
      const names = suggestionsByEvent[match[1]] ?? [];
      return Promise.resolve({ ok: true, json: async () => suggestionPayload(names) });
    }
    if (url.includes("/invites") && init?.method === "POST") {
      return Promise.resolve({ ok: true, json: async () => ({ ok: true }) });
    }
    return Promise.resolve({ ok: false, json: async () => ({}) });
  });
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => cleanup());

describe("DashboardPage — ADR 0025 'Games you might join' panel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the panel heading with suggested players from the nearest upcoming managed games", async () => {
    const fetchMock = buildFetch();
    renderWithTheme(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Suggested players for your games")).toBeInTheDocument();
    });
    // Game titles appear once in the owned GameCard list and once in the panel.
    expect(screen.getAllByText("Sunday Football").length).toBe(2);
    expect(screen.getAllByText("Midweek Football").length).toBe(2);
    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
      expect(screen.getByText("Carol")).toBeInTheDocument();
    });

    // Fetches suggestions for the 3 nearest upcoming managed games only —
    // not for the past owned game. Games without candidates are fetched but
    // omitted from the panel.
    const suggestionCalls = fetchMock.mock.calls
      .map(([url]) => String(url))
      .filter((u) => u.includes("/suggestions"));
    expect(suggestionCalls).toHaveLength(3);
    expect(suggestionCalls).toContain("/api/events/evt-owned-1/suggestions");
    expect(suggestionCalls).toContain("/api/events/evt-owned-2/suggestions");
    expect(suggestionCalls).toContain("/api/events/evt-admin-1/suggestions");
    expect(suggestionCalls).not.toContain("/api/events/evt-owned-past/suggestions");
  });

  it("hides the panel when no managed game has suggestions", async () => {
    buildFetch({ "evt-owned-1": [], "evt-owned-2": [], "evt-admin-1": [] });
    renderWithTheme(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("My Games")).toBeInTheDocument();
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText("Suggested players for your games")).not.toBeInTheDocument();
  });

  it("clicking a suggestion chip POSTs an invite and removes the chip", async () => {
    const fetchMock = buildFetch();
    renderWithTheme(<DashboardPage />);

    await waitFor(() => {
      expect(screen.getByText("Alice")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("Alice"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/events/evt-owned-1/invites",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: "user-Alice" }),
        }),
      );
    });
    await waitFor(() => {
      expect(screen.queryByText("Alice")).not.toBeInTheDocument();
      expect(screen.getByText("Bob")).toBeInTheDocument();
    });
  });
});