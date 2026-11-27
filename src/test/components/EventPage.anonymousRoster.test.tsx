import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import EventPage from "~/components/EventPage";

type SessionUser = { id: string; name: string };

// Stable session identity — a fresh object per render re-triggers load effects.
const mockSession: {
  data: { user: SessionUser } | null;
  isPending: boolean;
  refetch: ReturnType<typeof vi.fn>;
} = {
  data: null,
  isPending: false,
  refetch: vi.fn(),
};
vi.mock("~/lib/auth.client", () => ({
  useSession: () => mockSession,
  signOut: vi.fn(),
}));

type Row = { id: string; name: string; userId: string | null };

function makeEvent(players: Row[], overrides: Record<string, unknown> = {}) {
  return {
    id: "evt-1",
    title: "Monday Football",
    location: "Campo",
    dateTime: new Date(Date.now() + 5 * 86_400_000).toISOString(),
    timezone: "UTC",
    maxPlayers: 10,
    durationMinutes: 90,
    teamOneName: "",
    teamTwoName: "",
    isRecurring: false,
    isPublic: false,
    balanced: false,
    eloEnabled: false,
    hideEloInTeams: false,
    showCompetitiveData: false,
    splitCostsEnabled: false,
    mvpEnabled: false,
    mvpEloEnabled: false,
    sport: "football-5v5",
    recurrenceRule: null,
    ownerId: "owner-9",
    ownerName: "Sam",
    players,
    teamResults: [],
    gameStatus: null,
    gameId: null,
    ...overrides,
  };
}

function routeFetch(handlers: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    for (const [pattern, body] of Object.entries(handlers)) {
      if (u.includes(pattern)) {
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

function renderEvent(
  user: SessionUser | null,
  players: Row[],
  overrides: Record<string, unknown> = {},
) {
  mockSession.data = user ? { user } : null;
  vi.stubGlobal("fetch", routeFetch({
    "/known-players": { players: [] },
    "/rsvp": {},
    "/co-players": { players: [] },
    "/suggestions": { suggestions: [] },
    "/api/events/evt-1": makeEvent(players, overrides),
  }) as unknown as typeof fetch);
  renderWithTheme(<EventPage eventId="evt-1" />);
}

beforeEach(() => {
  mockSession.data = null;
  mockSession.refetch.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("EventPage — roster add controls follow the viewer (#1751)", () => {
  it("renders no add-player field for a signed-out visitor", async () => {
    renderEvent(null, [{ id: "p-1", name: "Alice", userId: null }]);

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/add player/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-player-submit")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in to join/i })).toBeInTheDocument();
  });

  it("keeps the add field for the signed-in owner", async () => {
    renderEvent(
      { id: "owner-9", name: "Sam" },
      [{ id: "p-1", name: "Alice", userId: null }],
    );

    expect(await screen.findByPlaceholderText(/add player/i)).toBeInTheDocument();
    expect(screen.getByTestId("add-player-submit")).toBeInTheDocument();
  });

  it("keeps the add field for a signed-in event admin", async () => {
    renderEvent(
      { id: "admin-1", name: "Alex" },
      [{ id: "p-1", name: "Alice", userId: null }],
      { isAdmin: true },
    );

    expect(await screen.findByPlaceholderText(/add player/i)).toBeInTheDocument();
    expect(screen.getByTestId("add-player-submit")).toBeInTheDocument();
  });

  it("keeps the add field for a signed-in rostered player", async () => {
    renderEvent(
      { id: "player-1", name: "Jo" },
      [{ id: "p-1", name: "Jo", userId: "player-1" }],
    );

    expect(await screen.findByPlaceholderText(/add player/i)).toBeInTheDocument();
    expect(screen.getByTestId("add-player-submit")).toBeInTheDocument();
  });
});
