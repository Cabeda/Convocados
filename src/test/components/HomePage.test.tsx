/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import HomePage from "~/components/HomePage";

// Mock __APP_VERSION__
(globalThis as any).__APP_VERSION__ = "0.0.0-test";

// Mock auth.client (imported by ResponsiveLayout / HomePage).
// Stable identity — a fresh object per render would re-trigger the
// session-dependent load effect on every re-render.
const mockSession = { data: { user: { id: "me", name: "Test User" } }, isPending: false };
vi.mock("~/lib/auth.client", () => ({
  useSession: () => mockSession,
  signOut: vi.fn(),
}));

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const upNext = [
  {
    id: "evt-play-1",
    title: "Sunday Football",
    location: "Central Park",
    dateTime: new Date(now + 1 * DAY).toISOString(),
    timezone: "UTC",
    sport: "football-5v5",
    maxPlayers: 10,
    playerCount: 6,
    isRecurring: true,
    status: "upcoming",
  },
  {
    id: "evt-play-2",
    title: "Midweek Football",
    location: "Riverside",
    dateTime: new Date(now + 2 * DAY).toISOString(),
    timezone: "UTC",
    sport: "football-5v5",
    maxPlayers: 10,
    playerCount: 4,
    isRecurring: false,
    status: "upcoming",
  },
];

const discover = [
  {
    id: "evt-pub-1",
    url: "/events/evt-pub-1",
    title: "Open Padel",
    location: "Court 1",
    sport: "padel",
    dateTime: new Date(now + 1 * DAY).toISOString(),
    timezone: "UTC",
    maxPlayers: 4,
    playerCount: 2,
    spotsLeft: 2,
    isRecurring: false,
    ownerId: "someone",
  },
];

const homeActions = [
  {
    type: "fill_spots",
    eventId: "evt-play-1",
    eventTitle: "Sunday Football",
    dateTime: new Date(now + 1 * DAY).toISOString(),
    timezone: "UTC",
    deadline: new Date(now + 1 * DAY).toISOString(),
    spotsLeft: 4,
  },
  {
    type: "pay_share",
    eventId: "evt-play-2",
    eventTitle: "Midweek Football",
    dateTime: new Date(now + 2 * DAY).toISOString(),
    timezone: "UTC",
    deadline: new Date(now + 2 * DAY).toISOString(),
    amount: 12.5,
    currency: "EUR",
  },
];

const homePayload = { upNext, discover, actions: homeActions };

const gamesPayload = {
  owned: [
    {
      id: "evt-play-1",
      title: "Sunday Football",
      location: "Central Park",
      dateTime: new Date(now + 1 * DAY).toISOString(),
      timezone: "UTC",
      sport: "football-5v5",
      maxPlayers: 10,
      playerCount: 6,
    },
  ],
  admin: [
    {
      id: "evt-admin-1",
      title: "Saturday Basketball",
      location: "Downtown Court",
      dateTime: new Date(now + 3 * DAY).toISOString(),
      timezone: "UTC",
      sport: "basketball",
      maxPlayers: 10,
      playerCount: 3,
    },
  ],
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

function buildFetch(home: unknown = homePayload) {
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url.startsWith("/api/me/home")) {
      return Promise.resolve({ ok: true, json: async () => home });
    }
    if (url.startsWith("/api/me/games")) {
      return Promise.resolve({ ok: true, json: async () => gamesPayload });
    }
    const match = /^\/api\/events\/([^/]+)\/suggestions$/.exec(url);
    if (match) {
      return Promise.resolve({ ok: true, json: async () => suggestionPayload(["Alice", "Bob"]) });
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

describe("HomePage — Up next + Discover (ADR 0041)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders Up next games from /api/me/home", async () => {
    buildFetch();
    renderWithTheme(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText("Up next")).toBeInTheDocument();
      expect(screen.getAllByText("Sunday Football").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Midweek Football").length).toBeGreaterThan(0);
    });
  });

  it("renders Discover games and a browse-all link to /public", async () => {
    buildFetch();
    renderWithTheme(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText("Discover")).toBeInTheDocument();
      expect(screen.getByText("Open Padel")).toBeInTheDocument();
    });
    const browseLinks = screen.getAllByText("Browse all public games");
    expect(browseLinks.length).toBeGreaterThan(0);
    expect(browseLinks[0].closest("a")).toHaveAttribute("href", "/public");
  });

  it("keeps owned/admin games in a collapsed Manage accordion", async () => {
    buildFetch();
    renderWithTheme(<HomePage />);
    const summary = await screen.findByRole("button", { name: /manage my games/i });
    // Collapsed by default.
    expect(summary).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(summary);
    await waitFor(() => {
      expect(summary).toHaveAttribute("aria-expanded", "true");
    });
    expect(screen.getByText("Games I Admin")).toBeInTheDocument();
  });

  it("still renders the ADR 0025 suggested-players panel and invites on click", async () => {
    const fetchMock = buildFetch();
    renderWithTheme(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText("Suggested players for your games")).toBeInTheDocument();
    });
    const alices = screen.getAllByText("Alice");
    fireEvent.click(alices[0]);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/events/evt-play-1/invites",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  it("renders the Needs you queue with action labels", async () => {
    buildFetch();
    renderWithTheme(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText("Needs you")).toBeInTheDocument();
    });
    expect(screen.getByText(/invite players/i)).toBeInTheDocument();
    expect(screen.getByText(/You owe 12.50 EUR/)).toBeInTheDocument();
  });

  it("falls back to a create CTA when there is nothing to show", async () => {    buildFetch({ upNext: [], discover: [] });
    renderWithTheme(<HomePage />);
    await waitFor(() => {
      expect(screen.getByText("No upcoming games yet.")).toBeInTheDocument();
    });
    expect(screen.getAllByText("Create a Game").length).toBeGreaterThan(0);
  });
});
