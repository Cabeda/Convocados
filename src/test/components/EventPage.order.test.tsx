/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import EventPage from "~/components/EventPage";
import { cssFor } from "../emotionCss";

const mockSession = { data: { user: { id: "u-1", name: "Jose Silva" } }, isPending: false, refetch: vi.fn() };
vi.mock("~/lib/auth.client", () => ({ useSession: () => mockSession, signOut: vi.fn() }));
vi.mock("~/components/PushPromptBanner", () => ({ PushPromptBanner: (p: { quiet?: boolean }) => <div data-testid="push-banner" data-quiet={String(!!p.quiet)}>Turn on reminders</div> }));

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
  it("puts nothing above the title: the push reminder is a later prompt, a quiet row at the end of the next game", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    const title = await screen.findByRole("heading", { level: 1, name: "Monday Football" });
    const recap = await screen.findByTestId("last-game-recap");
    const next = await screen.findByTestId("next-game");
    const banner = await screen.findByTestId("push-banner");
    expect(before(title, recap)).toBe(true);
    expect(before(recap, next)).toBe(true);
    expect(before(next, banner)).toBe(true);
    expect(banner).toHaveAttribute("data-quiet", "true");
  });

  it("does not ask for anything else while the recap still has something for the viewer to do", async () => {
    overrides = { postGameStatus: { ...status, hasScore: false, scoreOne: null, scoreTwo: null, allComplete: false } };
    renderWithTheme(<EventPage eventId="evt-1" />);
    await screen.findByRole("button", { name: /Add score/ });
    expect(screen.queryByTestId("push-banner")).not.toBeInTheDocument();
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

  it("holds one slot per place once the server has said how many there are, not a pitch of 16", () => {
    renderWithTheme(<EventPage eventId="evt-1" nextGameHint={{ maxPlayers: 6, phase: "open" }} />);
    expect(screen.getAllByTestId("skeleton-slot")).toHaveLength(6);
  });

  it("holds a pitch of 16 until it knows better", () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    expect(screen.getAllByTestId("skeleton-slot")).toHaveLength(16);
  });

  it("holds no next game when the server said there is none (a one-off that has ended) or it is cancelled", () => {
    renderWithTheme(<EventPage eventId="evt-1" nextGameHint={{ maxPlayers: 10, phase: "none" }} />);
    expect(screen.queryByTestId("next-game-skeleton")).not.toBeInTheDocument();
    cleanup();
    renderWithTheme(<EventPage eventId="evt-1" nextGameHint={{ maxPlayers: 10, phase: "cancelled" }} />);
    expect(screen.queryByTestId("next-game-skeleton")).not.toBeInTheDocument();
  });

  it("holds only the date line when sign-ups are about to open: there is no lineup to draw yet", () => {
    renderWithTheme(<EventPage eventId="evt-1" nextGameHint={{ maxPlayers: 10, phase: "signupsSoon" }} />);
    expect(screen.getByTestId("next-game-skeleton")).toBeInTheDocument();
    expect(screen.queryAllByTestId("skeleton-slot")).toHaveLength(0);
  });

  it("holds the strip's smaller place when this viewer last saw the strip here", () => {
    localStorage.setItem("recap:shape:evt-1", "strip");
    renderWithTheme(<EventPage eventId="evt-1" />);
    expect(screen.getByTestId("recap-skeleton")).toBeInTheDocument();
  });
});

describe("the app bar on the narrowest phones", () => {
  it("drops the Public games globe under 340px, so the avatar is not pushed off the screen (jsdom cannot measure: checked at 320px in a browser)", async () => {
    renderWithTheme(<EventPage eventId="evt-1" />);
    await screen.findByRole("heading", { level: 1 });
    const globe = screen.getByRole("link", { name: "Public Games" });
    expect(cssFor(globe)).toMatch(/@media \(max-width:\s*339\.95px\)\s*\{[^}]*display:\s*none/);
  });
});
