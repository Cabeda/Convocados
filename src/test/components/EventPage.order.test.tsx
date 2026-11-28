/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import EventPage from "~/components/EventPage";

const mockSession = { data: { user: { id: "u-1", name: "Jose Silva" } }, isPending: false, refetch: vi.fn() };
vi.mock("~/lib/auth.client", () => ({ useSession: () => mockSession, signOut: vi.fn() }));
vi.mock("~/components/PushPromptBanner", () => ({ PushPromptBanner: () => <div data-testid="push-banner">Turn on reminders</div> }));

const HOUR = 3_600_000;
const status = {
  gameEnded: true, hasScore: true, hasCost: false, allPaid: true, allComplete: true, isParticipant: true, isPlayer: true,
  latestHistoryId: "h1", costCurrency: "EUR", costAmount: null, hasPendingPastPayments: false, mvpEnabled: false,
  mvpComplete: true, bannerMvpComplete: true, myMvpComplete: true, scoreOne: 5, scoreTwo: 3,
  teamOneName: "Foxes", teamTwoName: "Lions", viewerTeam: 0, lastGameDateTime: new Date(Date.now() - 20 * HOUR).toISOString(), isRecurring: true,
  gamePayments: null, gameConfig: null,
};
let overrides: Record<string, unknown> = {};
const makeEvent = () => ({
  id: "evt-1", title: "Monday Football", location: "Campo",
  dateTime: new Date(Date.now() + 5 * 86_400_000).toISOString(),
  timezone: "UTC", maxPlayers: 10, durationMinutes: 90, teamOneName: "", teamTwoName: "",
  isRecurring: true, isPublic: false, balanced: false, eloEnabled: false, hideEloInTeams: false, showCompetitiveData: false,
  splitCostsEnabled: false, mvpEnabled: false, mvpEloEnabled: false, sport: "football-5v5",
  recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }),
  ownerId: "owner-9", ownerName: "Sam", players: [], teamResults: [], gameStatus: null, gameId: null, hasLastGame: true, postGameStatus: status, ...overrides,
});

beforeEach(() => {
  overrides = {};
  localStorage.clear();
  window.history.pushState({}, "", "/events/evt-1");
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
    const u = String(url);
    if (u.endsWith("/api/events/evt-1") || u.includes("/api/events/evt-1?")) return json(makeEvent());
    if (u.includes("/post-game-status")) return json(status);
    if (u.includes("/known-players") || u.includes("/co-players")) return json({ players: [] });
    if (u.includes("/suggestions")) return json({ suggestions: [] });
    if (u.endsWith("/cost")) return json(null);
    return json({});
  }) as unknown as typeof fetch);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const before = (a: Element, b: Element) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("EventPage — what sits above the title", () => {
  it("puts nothing above the title: the push reminder is a later prompt and comes after the recap", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    const title = await screen.findByRole("heading", { level: 1, name: "Monday Football" });
    const recap = await screen.findByTestId("last-game-recap");
    const banner = await screen.findByTestId("push-banner");
    expect(before(title, recap)).toBe(true);
    expect(before(recap, banner)).toBe(true);
  });

  it("no longer announces that the list was cleared: the recap strip tells the story", async () => {
    overrides = { wasReset: true };
    renderWithTheme(<EventPage eventId="evt-1" />);
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByText(/player list has been cleared|was reset for the next occurrence/i)).not.toBeInTheDocument();
  });
});

describe("EventPage — the loading page holds only the room that will be used", () => {
  it("shows no recap skeleton for a game with nothing to recap, so nothing jumps when the page arrives", () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    expect(screen.getByTestId("header-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("recap-skeleton")).not.toBeInTheDocument();
  });

  it("holds the recap's place when the server said a last game exists", () => {
    renderWithTheme(<EventPage eventId="evt-1" hasLastGame />);
    expect(screen.getByTestId("recap-skeleton")).toBeInTheDocument();
  });

  it("holds the strip's smaller place when this viewer last saw the strip here", () => {
    localStorage.setItem("recap:shape:evt-1", "strip");
    renderWithTheme(<EventPage eventId="evt-1" />);
    expect(screen.getByTestId("recap-skeleton")).toBeInTheDocument();
  });
});
