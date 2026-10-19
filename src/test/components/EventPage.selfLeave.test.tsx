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

type Row = { id: string; name: string; userId: string | null };

function makeEvent(players: Row[]) {
  const inFiveDays = new Date(Date.now() + 5 * 86_400_000).toISOString();
  return {
    id: "evt-1",
    title: "Monday Football",
    location: "Campo",
    dateTime: inFiveDays,
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
  };
}

/** Handlers are checked in insertion order — more specific URLs first. */
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

function renderEvent(players: Row[]) {
  vi.stubGlobal("fetch", routeFetch({
    "/known-players": { players: [] },
    "/rsvp": {},
    "/co-players": { players: [] },
    "/suggestions": { suggestions: [] },
    "/api/events/evt-1": makeEvent(players),
  }) as unknown as typeof fetch);
  renderWithTheme(<EventPage eventId="evt-1" />);
}


beforeEach(() => {
  mockSession.data = { user: { id: "u-1", name: "Jose Silva" } };
  mockSession.refetch.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("EventPage — self-leave on an unlinked roster row (#1269)", () => {
  it("does NOT show the joined hero when the signed-in user's name matches an unlinked row (#1331 removal-only)", async () => {
    renderEvent([{ id: "p-1", name: "José Silva", userId: null }]);
    // Name-match is removal-only: participation requires a linked row, so the
    // "you joined as" hero (and its confirmed Leave) does not render. The user
    // can still self-leave via the roster X, and Join is available to link.
    expect(await screen.findByRole("button", { name: /join as/i })).toBeInTheDocument();
    expect(screen.queryByText("You joined as José Silva")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave" })).not.toBeInTheDocument();
  });

  it("does NOT show the Leave button when no roster row matches the user", async () => {
    renderEvent([{ id: "p-1", name: "Bob Marley", userId: null }]);
    expect(await screen.findByRole("button", { name: /join as/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave" })).not.toBeInTheDocument();
  });

  it("does NOT treat a linked row owned by ANOTHER account as self, even when the name matches", async () => {
    renderEvent([{ id: "p-1", name: "Jose Silva", userId: "u-someone-else" }]);
    expect(await screen.findByRole("button", { name: /join as/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Leave" })).not.toBeInTheDocument();
  });

  it("keeps the LINKED self-leave on the existing /leave path, with no name match required", async () => {
    const user = userEvent.setup();
    renderEvent([{ id: "p-linked", name: "Ze", userId: "u-1" }]);

    expect(await screen.findByText("You joined as Ze")).toBeInTheDocument();
    // Deliberate behaviour change (F4): the linked path now confirms first,
    // same as the unlinked path, then fires the existing /leave endpoint.
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(await screen.findByText("Leave this game?")).toBeInTheDocument();

    await user.click(screen.getByTestId("leave-dialog-confirm"));

    await waitFor(() => {
      const all = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as Array<
        [string, RequestInit | undefined]
      >;
      expect(all.some(([url, init]) => String(url).includes("/api/events/evt-1/leave") && init?.method === "POST")).toBe(true);
    });
  });

  it("linked self-leave does NOT fire the /leave call until the dialog is confirmed", async () => {
    const user = userEvent.setup();
    renderEvent([{ id: "p-linked", name: "Ze", userId: "u-1" }]);

    await user.click(await screen.findByRole("button", { name: "Leave" }));
    await screen.findByText("Leave this game?");

    const all = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, RequestInit | undefined]
    >;
    expect(all.some(([url, init]) => String(url).includes("/leave") && init?.method === "POST")).toBe(false);

    await user.click(screen.getByTestId("leave-dialog-cancel"));
    expect(all.some(([url, init]) => String(url).includes("/leave") && init?.method === "POST")).toBe(false);
  });
});
