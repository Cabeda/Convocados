import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import EventPage from "~/components/EventPage";

const mockSession = { data: { user: { id: "u-1", name: "Jose Silva" } } as { user: { id: string; name: string } } | null, isPending: false, refetch: vi.fn() };
vi.mock("~/lib/auth.client", () => ({ useSession: () => mockSession, signOut: vi.fn() }));

let overrides: Record<string, unknown> = {};
const makeEvent = () => ({
  id: "evt-1", title: "Monday Football", location: "Campo",
  dateTime: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  timezone: "UTC", maxPlayers: 10, durationMinutes: 90, teamOneName: "", teamTwoName: "",
  isRecurring: false, isPublic: false, balanced: false, eloEnabled: false, hideEloInTeams: false, showCompetitiveData: false,
  splitCostsEnabled: false, mvpEnabled: false, mvpEloEnabled: false, sport: "football-5v5", recurrenceRule: null,
  ownerId: "owner-9", ownerName: "Sam", players: [], teamResults: [], gameStatus: null, gameId: null, ...overrides,
});

beforeEach(() => {
  overrides = {};
  mockSession.data = { user: { id: "u-1", name: "Jose Silva" } };
  window.history.pushState({}, "", "/events/evt-1");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
    const u = String(url);
    if (u.endsWith("/api/events/evt-1") || u.includes("/api/events/evt-1?")) return json(makeEvent());
    if (u.includes("/known-players") || u.includes("/co-players")) return json({ players: [] });
    if (u.includes("/suggestions")) return json({ suggestions: [] });
    if (u.endsWith("/cost")) return json(null);
    return json({});
  }) as unknown as typeof fetch);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("EventPage — the header slice", () => {
  it("shows the header skeleton while loading, then the title as the page's one h1", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    expect(screen.getByTestId("header-skeleton")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { level: 1, name: "Monday Football" })).toBeInTheDocument();
    expect(screen.queryByTestId("header-skeleton")).not.toBeInTheDocument();
  });

  it("no longer carries the old header's urgency pill, price card or follow text button", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/^Next game:/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Following" })).not.toBeInTheDocument();
    expect(screen.queryByText("View payments")).not.toBeInTheDocument();
  });

  it("gives an upcoming game its Next game block, with the date in condensed numerals under a label", async () => {
    overrides = { isRecurring: true, recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }) };
    renderWithTheme(<EventPage eventId="evt-1" />);
    expect(await screen.findByRole("heading", { level: 2, name: "Next game" })).toBeInTheDocument();
    expect(screen.getByTestId("next-game-date")).toHaveTextContent(/\d{2}:\d{2}$/);
  });

  it("a one-off game that has not been played yet is still the next game", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    expect(await screen.findByRole("heading", { level: 2, name: "Next game" })).toBeInTheDocument();
  });

  it("shows the next-game skeleton while loading, in the place the block will take", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    expect(screen.getByTestId("next-game-skeleton")).toBeInTheDocument();
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("next-game-skeleton")).not.toBeInTheDocument();
  });

  describe("a cancelled game", () => {
    beforeEach(() => { overrides = { gameStatus: "cancelled" }; });

    it("says so above the recap and tells a player nobody can join any more", async () => {
      renderWithTheme(<EventPage eventId="evt-1" />);
      expect(await screen.findByRole("heading", { level: 2, name: "This game was cancelled" })).toBeInTheDocument();
      expect(screen.getByText("Nobody can join or be added any more.")).toBeInTheDocument();
    });

    it("tells an admin it cannot be reopened and gives a real button to plan a new one", async () => {
      overrides = { gameStatus: "cancelled", ownerId: "u-1" };
      renderWithTheme(<EventPage eventId="evt-1" />);
      expect(await screen.findByText("A cancelled game can't be reopened. Plan a new one instead.")).toBeInTheDocument();
      expect(screen.getByRole("link", { name: "Plan a new game" })).toHaveAttribute("href", "/");
    });

    it("gives a player the news and no button", async () => {
      renderWithTheme(<EventPage eventId="evt-1" />);
      await screen.findByRole("heading", { level: 2, name: "This game was cancelled" });
      expect(screen.queryByRole("link", { name: "Plan a new game" })).not.toBeInTheDocument();
    });

    it("hides the RSVP and the lineup, which the server would refuse with a 409", async () => {
      renderWithTheme(<EventPage eventId="evt-1" />);
      await screen.findByRole("heading", { level: 2, name: "This game was cancelled" });
      expect(screen.queryByRole("button", { name: "I'm in" })).not.toBeInTheDocument();
      expect(screen.queryByTestId("lineup-slots")).not.toBeInTheDocument();
    });

    it("has no next game to point at", async () => {
      overrides = { gameStatus: "cancelled", ownerId: "u-1", isRecurring: true, recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }) };
      renderWithTheme(<EventPage eventId="evt-1" />);
      await screen.findByRole("heading", { level: 1 });
      expect(screen.queryByTestId("next-game")).not.toBeInTheDocument();
    });
  });

  it("offers the RSVP on a game that is on, so the cancelled test above means something", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    expect(await screen.findByRole("button", { name: "I'm in" })).toBeInTheDocument();
    expect(screen.queryByText("This game was cancelled")).not.toBeInTheDocument();
  });
});
