import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
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
  globalThis.fetch = routeFetch({
    "/known-players": { players: [] },
    "/rsvp": {},
    "/co-players": { players: [] },
    "/suggestions": { suggestions: [] },
    "/api/events/evt-1": makeEvent(players),
  }) as unknown as typeof fetch;
  renderWithTheme(<EventPage eventId="evt-1" />);
}

function deleteCalls() {
  const all = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as Array<
    [string, RequestInit | undefined]
  >;
  return all.filter(([url, init]) => String(url).includes("/players") && init?.method === "DELETE");
}

beforeEach(() => {
  mockSession.data = { user: { id: "u-1", name: "Jose Silva" } };
  mockSession.refetch.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EventPage — self-leave on an unlinked roster row (#1269)", () => {
  it("shows the Leave button when the signed-in user's name matches an unlinked row", async () => {
    renderEvent([{ id: "p-1", name: "José Silva", userId: null }]);
    expect(await screen.findByText("You joined as José Silva")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /join as/i })).not.toBeInTheDocument();
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

  it("confirms with the self copy, then removes through the existing DELETE /players route", async () => {
    const user = userEvent.setup();
    renderEvent([{ id: "p-unlinked", name: "José Silva", userId: null }]);

    await user.click(await screen.findByRole("button", { name: "Leave" }));
    expect(await screen.findByText("Leave this game?")).toBeInTheDocument();
    expect(screen.getByText("You'll be removed from the player list.")).toBeInTheDocument();

    await user.click(screen.getByTestId("leave-dialog-confirm"));

    const calls = deleteCalls();
    expect(calls.length).toBeGreaterThan(0);
    const [url, init] = calls[calls.length - 1];
    expect(String(url)).toContain("/api/events/evt-1/players");
    expect(JSON.parse(String(init?.body))).toEqual({ playerId: "p-unlinked" });
  });

  it("does not fire the DELETE until the dialog is confirmed", async () => {
    const user = userEvent.setup();
    renderEvent([{ id: "p-unlinked", name: "José Silva", userId: null }]);

    await user.click(await screen.findByRole("button", { name: "Leave" }));
    await screen.findByText("Leave this game?");
    expect(deleteCalls()).toHaveLength(0);

    await user.click(screen.getByTestId("leave-dialog-cancel"));
    expect(deleteCalls()).toHaveLength(0);
  });

  it("keeps the LINKED self-leave on the existing /leave path, with no name match required", async () => {
    const user = userEvent.setup();
    renderEvent([{ id: "p-linked", name: "Ze", userId: "u-1" }]);

    expect(await screen.findByText("You joined as Ze")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Leave" }));

    const all = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls as Array<
      [string, RequestInit | undefined]
    >;
    expect(all.some(([url, init]) => String(url).includes("/api/events/evt-1/leave") && init?.method === "POST")).toBe(true);
    expect(screen.queryByTestId("leave-dialog-confirm")).toBeNull();
  });
});
