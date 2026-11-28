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

  it("keeps the next date of a weekly game on the page until the next-game block exists", async () => {
    overrides = { isRecurring: true, recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }) };
    renderWithTheme(<EventPage eventId="evt-1" />);
    expect(await screen.findByText(/^Next game · /)).toBeInTheDocument();
  });

  it("does not repeat the date for a one-off game, which the header already states", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/^Next game · /)).not.toBeInTheDocument();
  });

  it("says the date of the NEXT game, never the one that already passed", async () => {
    overrides = {
      isRecurring: true, recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }),
      dateTime: new Date(Date.now() - 3 * 3_600_000).toISOString(),
    };
    renderWithTheme(<EventPage eventId="evt-1" />);
    const line = await screen.findByText(/^Next game · /);
    const past = new Date(overrides.dateTime as string);
    const day = new Intl.DateTimeFormat("en", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).format(past);
    expect(line.textContent).not.toContain(day);
  });
});
