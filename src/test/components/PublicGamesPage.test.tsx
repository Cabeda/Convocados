import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import PublicGamesPage from "~/components/PublicGamesPage";

// Mock __APP_VERSION__
(globalThis as any).__APP_VERSION__ = "0.0.0-test";

// Mock auth.client (imported by ResponsiveLayout)
vi.mock("~/lib/auth.client", () => ({
  useSession: () => ({ data: null, isPending: false }),
  signOut: vi.fn(),
}));

const mockEvents = [
  {
    id: "evt-1",
    title: "Sunday Football",
    location: "Central Park",
    latitude: 40.785091,
    longitude: -73.968285,
    sport: "football-5v5",
    dateTime: new Date(2026, 5, 20, 18, 0).toISOString(),
    maxPlayers: 10,
    playerCount: 7,
    spotsLeft: 3,
  },
  {
    id: "evt-2",
    title: "Basketball Night",
    location: "Downtown Court",
    latitude: null,
    longitude: null,
    sport: "basketball",
    dateTime: new Date(2026, 5, 21, 20, 0).toISOString(),
    maxPlayers: 10,
    playerCount: 10,
    spotsLeft: 0,
  },
];

const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

afterEach(() => cleanup());

describe("PublicGamesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ data: mockEvents, nextCursor: null, hasMore: false }),
    });
  });

  it("renders the page heading", async () => {
    renderWithTheme(<PublicGamesPage />);
    expect(screen.getByText("Public Games")).toBeInTheDocument();
  });

  it("fetches and displays events", async () => {
    renderWithTheme(<PublicGamesPage />);

    await waitFor(() => {
      expect(screen.getByText("Sunday Football")).toBeInTheDocument();
      expect(screen.getByText("Basketball Night")).toBeInTheDocument();
    });
  });

  it("shows spots left chip for available games", async () => {
    renderWithTheme(<PublicGamesPage />);

    await waitFor(() => {
      expect(screen.getByText(/3 spot\(s\) left/i)).toBeInTheDocument();
    });
  });

  it("shows full chip for full games", async () => {
    renderWithTheme(<PublicGamesPage />);

    await waitFor(() => {
      expect(screen.getByText(/Full/i)).toBeInTheDocument();
    });
  });

  it("shows join game buttons", async () => {
    renderWithTheme(<PublicGamesPage />);

    await waitFor(() => {
      const joinButtons = screen.getAllByText(/^Join$/i);
      expect(joinButtons).toHaveLength(2);
    });
  });

  it("shows location for events that have one", async () => {
    renderWithTheme(<PublicGamesPage />);

    await waitFor(() => {
      expect(screen.getByText("Central Park")).toBeInTheDocument();
      expect(screen.getByText("Downtown Court")).toBeInTheDocument();
    });
  });

  it("shows empty state when no events", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [], nextCursor: null, hasMore: false }),
    });

    renderWithTheme(<PublicGamesPage />);

    await waitFor(() => {
      expect(screen.getByText(/No public games/i)).toBeInTheDocument();
    });
  });

  it("shows load more button when hasMore is true", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: mockEvents, nextCursor: "cursor-1", hasMore: true }),
    });

    renderWithTheme(<PublicGamesPage />);

    await waitFor(() => {
      expect(screen.getByText(/Load more/i)).toBeInTheDocument();
    });
  });

  it("filters by has spots toggle", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PublicGamesPage />);

    await waitFor(() => {
      expect(screen.getByText("Sunday Football")).toBeInTheDocument();
    });

    const spotsSwitch = screen.getByLabelText(/Has spots/i);
    await user.click(spotsSwitch);

    await waitFor(() => {
      expect(screen.queryByText("Basketball Night")).not.toBeInTheDocument();
      expect(screen.getByText("Sunday Football")).toBeInTheDocument();
    });
  });

  it("shows no matching games when filter excludes all", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [mockEvents[1]], // Only the full game
        nextCursor: null,
        hasMore: false,
      }),
    });

    const user = userEvent.setup();
    renderWithTheme(<PublicGamesPage />);

    await waitFor(() => {
      expect(screen.getByText("Basketball Night")).toBeInTheDocument();
    });

    const spotsSwitch = screen.getByLabelText(/Has spots/i);
    await user.click(spotsSwitch);

    await waitFor(() => {
      expect(screen.getByText(/No games match/i)).toBeInTheDocument();
    });
  });
});
