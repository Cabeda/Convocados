import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import GameDetailPage from "~/components/GameDetailPage";

const mockUseSession = vi.fn();
vi.mock("~/lib/auth.client", () => ({
  useSession: () => mockUseSession(),
  signOut: vi.fn(),
}));

const entry = {
  id: "h-1",
  eventId: "evt-1",
  dateTime: new Date(Date.UTC(2026, 6, 13, 19, 0)).toISOString(),
  status: "played",
  scoreOne: 3,
  scoreTwo: 2,
  teamOneName: "Ninjas",
  teamTwoName: "Gunas",
  teamsSnapshot: JSON.stringify([
    { team: "Ninjas", players: [{ name: "Alice", order: 0 }] },
    { team: "Gunas", players: [{ name: "Bob", order: 0 }] },
  ]),
  paymentsSnapshot: null,
  source: "live",
  eloProcessed: true,
  isFriendly: false,
};

const eventPayload = {
  id: "evt-1",
  title: "Monday Football",
  location: "Campo",
  latitude: null,
  longitude: null,
  timezone: "UTC",
  ownerId: "owner-1",
  teamOneName: "Ninjas",
  teamTwoName: "Gunas",
  sport: "football-5v5",
  players: [],
};

function routeFetch(handlers: Record<string, unknown>) {
  return vi.fn(async (url: string) => {
    const u = String(url);
    for (const [pattern, body] of Object.entries(handlers)) {
      if (u.includes(pattern)) {
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

beforeEach(() => {
  mockUseSession.mockReturnValue({ data: null, isPending: false });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GameDetailPage", () => {
  it("renders a single game and links back to the history list", async () => {
    globalThis.fetch = routeFetch({
      "/mvp": { mvp: null, isVotingOpen: false, hasVoted: null, totalVotes: 0, eligibleVoters: 0, participants: [] },
      "/history/h-1": entry,
      "/known-players": { players: [] },
      "/ratings": { data: [] },
      "/cost": { totalAmount: 0, currency: "EUR", payments: [] },
      "/api/events/evt-1": eventPayload,
    }) as unknown as typeof fetch;

    renderWithTheme(<GameDetailPage eventId="evt-1" historyId="h-1" />);

    expect(await screen.findByText("Monday Football")).toBeInTheDocument();
    expect(screen.getByText("Ninjas")).toBeInTheDocument();
    expect(screen.getByText("Gunas")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view history/i })).toHaveAttribute("href", "/events/evt-1/history");
    // No self-link on the single game page.
    expect(screen.queryByTestId("open-game-link")).not.toBeInTheDocument();
  });

  it("shows a not-found state for a missing game", async () => {
    globalThis.fetch = vi.fn(async (url: string) => {
      const u = String(url);
      if (u.includes("/history/missing")) return new Response(JSON.stringify({ error: "Not found." }), { status: 404 });
      if (u.includes("/cost")) return new Response(JSON.stringify({ totalAmount: 0, currency: "EUR", payments: [] }), { status: 200 });
      return new Response(JSON.stringify(eventPayload), { status: 200 });
    }) as unknown as typeof fetch;

    renderWithTheme(<GameDetailPage eventId="evt-1" historyId="missing" />);
    expect(await screen.findByText("Game not found")).toBeInTheDocument();
  });
});
