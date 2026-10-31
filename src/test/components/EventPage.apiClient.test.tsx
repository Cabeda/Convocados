import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import EventPage from "~/components/EventPage";

// Stable session identity — a fresh object per render re-triggers load effects.
const mockSession = {
  data: { user: { id: "u-1", name: "Jose Silva" } },
  isPending: false,
  refetch: vi.fn(),
};
vi.mock("~/lib/auth.client", () => ({
  useSession: () => mockSession,
  signOut: vi.fn(),
}));

function makeEvent() {
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
    players: [],
    teamResults: [],
    gameStatus: null,
    gameId: null,
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

function stubFetch() {
  const fetchMock = routeFetch({
    "/known-players": { players: [] },
    "/rsvp": {},
    "/co-players": { players: [] },
    "/suggestions": { suggestions: [] },
    "/balance": { callerBalance: { amount: 0 } },
    "/api/events/evt-1": makeEvent(),
  });
  vi.stubGlobal("fetch", fetchMock as unknown as typeof fetch);
  return fetchMock;
}

beforeEach(() => {
  mockSession.data = { user: { id: "u-1", name: "Jose Silva" } };
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("EventPage — API calls go through the typed client", () => {
  it("loads the Event with a GET built by the client", async () => {
    const fetchMock = stubFetch();

    renderWithTheme(<EventPage eventId="evt-1" />);

    expect(await screen.findByText("Monday Football")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/events/evt-1", { method: "GET" });
  });

  it("sends the join write through the client with its JSON body and headers", async () => {
    const user = userEvent.setup();
    const fetchMock = stubFetch();

    renderWithTheme(<EventPage eventId="evt-1" />);
    await user.click(await screen.findByRole("button", { name: /join as/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith("/api/events/evt-1/players", {
        method: "POST",
        headers: {
          "X-Client-Id": expect.any(String),
          "Idempotency-Key": expect.any(String),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ name: "Jose Silva", linkToAccount: true }),
      });
    });
  });
});
