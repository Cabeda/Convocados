import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import EventPage from "~/components/EventPage";

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

function stubFetch() {
  const json = (body: unknown) =>
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  return vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("/known-players")) return json({ players: [] });
    if (u.includes("/rsvp")) return json({});
    if (u.includes("/co-players")) return json({ players: [] });
    if (u.includes("/suggestions")) return json({ suggestions: [] });
    if (u.includes("/balance")) return json({ callerBalance: { amount: 0 } });
    if (u.includes("/api/events/evt-1")) return json(makeEvent());
    return json({});
  });
}

beforeEach(() => {
  mockSession.data = { user: { id: "u-1", name: "Jose Silva" } };
  window.history.pushState({}, "", "/events/evt-1?action=share");
  vi.stubGlobal("fetch", stubFetch() as unknown as typeof fetch);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as { share?: unknown }).share;
  window.history.pushState({}, "", "/");
});

describe("EventPage — action=share deep link", () => {
  it("opens the share routine exactly once when the event loads", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });

    renderWithTheme(<EventPage eventId="evt-1" />);

    expect(await screen.findByText("Monday Football")).toBeInTheDocument();
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));

    const payload = share.mock.calls[0][0] as { title: string; text: string; url: string };
    expect(payload.title).toBe("Monday Football");
    expect(payload.url).toContain("/events/evt-1");
    // Re-sharing a link that itself carries action=share would make every
    // recipient fire their own share sheet.
    expect(payload.url).not.toContain("action=share");
    // The address bar must lose the action too, so a reload does not reopen it.
    expect(window.location.search).not.toContain("action");

    // A background refetch of the event must not open the sheet again.
    window.dispatchEvent(new Event("focus"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(share).toHaveBeenCalledTimes(1);
  });
});
