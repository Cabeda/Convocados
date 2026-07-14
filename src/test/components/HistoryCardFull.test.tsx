import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { screen, waitFor, cleanup, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { HistoryCardFull, type HistoryCardFullEntry } from "~/components/HistoryCardFull";

(globalThis as any).__APP_VERSION__ = "0.0.0-test";

const mockUseSession = vi.fn();
vi.mock("~/lib/auth.client", () => ({
  useSession: () => mockUseSession(),
  signOut: vi.fn(),
}));

const baseEntry: HistoryCardFullEntry = {
  id: "h-1",
  eventId: "evt-1",
  dateTime: new Date(Date.UTC(2026, 6, 13, 19, 0)).toISOString(),
  status: "played",
  scoreOne: 11,
  scoreTwo: 5,
  teamOneName: "Ninjas",
  teamTwoName: "Gunas",
  teamsSnapshot: JSON.stringify([
    {
      team: "Ninjas",
      players: [
        { name: "João Fernandes", order: 0 },
        { name: "Rodrigo Stange", order: 1 },
      ],
    },
    {
      team: "Gunas",
      players: [
        { name: "Gonçalo", order: 0 },
        { name: "TF", order: 1 },
      ],
    },
  ]),
  paymentsSnapshot: JSON.stringify([
    { playerName: "João Fernandes", amount: 5, status: "paid" },
    { playerName: "Rodrigo Stange", amount: 5, status: "pending" },
    { playerName: "Gonçalo", amount: 5, status: "paid" },
    { playerName: "TF", amount: 5, status: "paid" },
  ]),
  editableUntil: new Date(2026, 6, 20, 19, 0).toISOString(),
  editable: true,
  source: "live",
  eloProcessed: true,
  isFriendly: false,
  eloUpdates: [
    { name: "João Fernandes", delta: 13 },
    { name: "Rodrigo Stange", delta: 14 },
    { name: "Gonçalo", delta: -19 },
    { name: "TF", delta: -18 },
  ],
};

const event = {
  id: "evt-1",
  title: "Monday Football",
  location: "Campo do Maia",
  latitude: 41.15,
  longitude: -8.61,
  timezone: "UTC",
  ownerId: "owner-1",
};

const cost = {
  totalAmount: 80,
  currency: "EUR",
  payments: [
    { playerName: "João Fernandes", amount: 8, status: "paid" as const },
    { playerName: "Rodrigo Stange", amount: 8, status: "pending" as const },
    { playerName: "Gonçalo", amount: 8, status: "paid" as const },
    { playerName: "TF", amount: 8, status: "paid" as const },
  ],
};

const mvp = {
  mvp: [{ playerId: "name:TF", playerName: "TF", voteCount: 2 }],
  isVotingOpen: true,
  hasVoted: false,
  totalVotes: 2,
  eligibleVoters: 4,
  participants: [
    { id: "name:João Fernandes", name: "João Fernandes", voteCount: 0 },
    { id: "name:Rodrigo Stange", name: "Rodrigo Stange", voteCount: 0 },
    { id: "name:Gonçalo", name: "Gonçalo", voteCount: 0 },
    { id: "name:TF", name: "TF", voteCount: 2 },
  ],
};

function mockFetchSequence(handlers: Record<string, unknown>) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const key = `${method} ${url}`;
    for (const [pattern, response] of Object.entries(handlers)) {
      if (key.includes(pattern)) {
        return new Response(JSON.stringify(response), { status: 200, headers: { "Content-Type": "application/json" } });
      }
    }
    return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
  });
}

function renderCard(overrides: Partial<HistoryCardFullEntry> = {}, session: { user?: { id: string; name: string } } | null = { user: { id: "u-1", name: "João Fernandes" } }) {
  mockUseSession.mockReturnValue({ data: session, isPending: false });
  const entry = { ...baseEntry, ...overrides };
  return renderWithTheme(
    <HistoryCardFull
      entry={entry}
      eventId="evt-1"
      event={event}
      cost={cost}
      mvp={mvp}
      isOwner={false}
      isAdmin={false}
      isAuthenticated={!!session?.user}
      userName={session?.user?.name ?? null}
      onUpdate={vi.fn()}
      onDelete={vi.fn()}
      knownPlayers={[]}
      playerRatings={[]}
    />,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  globalThis.fetch = mockFetchSequence({}) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HistoryCardFull — header", () => {
  it("renders date and time", () => {
    renderCard();
    // Date rendered in compact format: weekday + day + month (e.g., "Mon, 13 Jul")
    expect(screen.getByText(/13 Jul/i)).toBeInTheDocument();
    expect(screen.getByText(/19:00/i)).toBeInTheDocument();
  });

  it("renders location from event", () => {
    renderCard();
    expect(screen.getByText(/Campo do Maia/)).toBeInTheDocument();
  });

  it("renders cost summary from event cost", () => {
    renderCard();
    expect(screen.getByText(/80/)).toBeInTheDocument();
    expect(screen.getByText(/8\.00/)).toBeInTheDocument();
  });

  it("shows 'Add location' inline for owner when missing", () => {
    cleanup();
    renderWithTheme(
      <HistoryCardFull
        entry={baseEntry}
        eventId="evt-1"
        event={{ ...event, location: "" }}
        cost={cost}
        mvp={mvp}
        isOwner
        isAdmin={false}
        isAuthenticated
        userName="owner"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        knownPlayers={[]}
        playerRatings={[]}
      />,
    );
    expect(screen.getByRole("link", { name: /add location/i })).toBeInTheDocument();
  });

  it("shows 'Add cost' inline for owner when missing", () => {
    renderWithTheme(
      <HistoryCardFull
        entry={baseEntry}
        eventId="evt-1"
        event={event}
        cost={null}
        mvp={mvp}
        isOwner
        isAdmin={false}
        isAuthenticated
        userName="owner"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        knownPlayers={[]}
        playerRatings={[]}
      />,
    );
    expect(screen.getByRole("link", { name: /add cost/i })).toBeInTheDocument();
  });
});

describe("HistoryCardFull — status dropdown", () => {
  it("renders 'Played' status chip with dropdown trigger", () => {
    renderCard();
    expect(screen.getByTestId("status-chip")).toHaveTextContent(/played/i);
  });

  it("opens menu with 3 options when clicked", async () => {
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByTestId("status-chip"));
    expect(screen.getByRole("menuitem", { name: /played/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /cancelled/i })).toBeInTheDocument();
    expect(screen.getByRole("menuitem", { name: /upcoming/i })).toBeInTheDocument();
  });

  it("PATCHes status to cancelled when 'Cancelled' is picked", async () => {
    const fetchMock = mockFetchSequence({
      "PATCH /api/events/evt-1/history/h-1": { ...baseEntry, status: "cancelled" },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const user = userEvent.setup();
    renderCard();
    await user.click(screen.getByTestId("status-chip"));
    await user.click(screen.getByRole("menuitem", { name: /cancelled/i }));
    await waitFor(() => {
      const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
      const patchCall = calls.find(([u, i]) => u.includes("/history/h-1") && (i?.method ?? "GET") === "PATCH");
      expect(patchCall).toBeDefined();
      const body = JSON.parse(patchCall![1].body as string);
      expect(body).toEqual({ status: "cancelled" });
    });
  });

  it("does not show the two old bottom buttons (Mark as played/cancelled)", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: /mark as played/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark as cancelled/i })).not.toBeInTheDocument();
  });
});

describe("HistoryCardFull — score", () => {
  it("does not render a 'Save score' button", () => {
    renderCard();
    expect(screen.queryByRole("button", { name: /save score/i })).not.toBeInTheDocument();
  });

  it("auto-saves score on change after debounce", async () => {
    const fetchMock = mockFetchSequence({
      "PATCH /api/events/evt-1/history/h-1": { ...baseEntry, scoreOne: 12 },
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    renderCard();
    const plusButtons = screen.getAllByTestId("score-plus");
    await userEvent.setup().click(plusButtons[0]);
    await waitFor(() => {
      const calls = fetchMock.mock.calls as Array<[string, RequestInit]>;
      const patchCall = calls.find(([u, i]) => u.includes("/history/h-1") && (i?.method ?? "GET") === "PATCH");
      expect(patchCall).toBeDefined();
    }, { timeout: 2000 });
  });

  it("renders horizontal FotMob-style score with team names alongside", () => {
    renderCard();
    // ScoreRoller with hideLabel should not show team name inside it.
    // The team names appear once each in the score row, once in the players stream.
    const ninjasOccurrences = screen.getAllByText("Ninjas");
    const gunasOccurrences = screen.getAllByText("Gunas");
    expect(ninjasOccurrences.length).toBeGreaterThanOrEqual(2);
    expect(gunasOccurrences.length).toBeGreaterThanOrEqual(2);
  });
});

describe("HistoryCardFull — Players stream", () => {
  it("renders one row per player across both teams", () => {
    renderCard();
    expect(screen.getByText("João Fernandes")).toBeInTheDocument();
    expect(screen.getByText("Rodrigo Stange")).toBeInTheDocument();
    expect(screen.getByText("Gonçalo")).toBeInTheDocument();
    expect(screen.getByText("TF")).toBeInTheDocument();
  });

  it("renders team names as section headers with counts", () => {
    renderCard();
    // "Ninjas" appears in score + players stream. Use heading role for section.
    const ninjasHeaders = screen.getAllByText("Ninjas");
    expect(ninjasHeaders.length).toBeGreaterThanOrEqual(2);
    // Count badge "(2)" next to each team name
    expect(screen.getAllByText("(2)").length).toBe(2);
  });

  it("shows ELO delta on each player row", () => {
    renderCard();
    expect(screen.getByText("+13")).toBeInTheDocument();
    expect(screen.getByText("+14")).toBeInTheDocument();
    expect(screen.getByText("-19")).toBeInTheDocument();
    expect(screen.getByText("-18")).toBeInTheDocument();
  });

  it("shows payment chip on each row with the amount", () => {
    renderCard();
    const joaoRow = screen.getByText("João Fernandes").closest("[data-player-row]") as HTMLElement;
    // Paid = filled chip with amount
    expect(within(joaoRow).getByText(/5\.00/i)).toBeInTheDocument();
    // João is paid (success) — check for check icon
    expect(within(joaoRow).getByTestId("CheckCircleIcon")).toBeInTheDocument();
  });

  it("shows vote count next to MVP star", () => {
    renderCard();
    // TF has 2 votes
    const tfRow = screen.getByText("TF").closest("[data-player-row]") as HTMLElement;
    expect(within(tfRow).getByText("2")).toBeInTheDocument();
  });

  it("does not render a separate Payments or MVP section heading", () => {
    renderCard();
    // No "Payments" or "Vote MVP" section headers in the new layout
    expect(screen.queryByRole("heading", { name: /^payments$/i })).not.toBeInTheDocument();
  });
});

describe("HistoryCardFull — cancelled", () => {
  it("dims the card when status is cancelled", () => {
    renderCard({ status: "cancelled" });
    const paper = document.querySelector(".MuiPaper-root")!;
    expect(paper).toHaveStyle({ opacity: "0.7" });
  });

  it("hides score section when cancelled", () => {
    renderCard({ status: "cancelled" });
    expect(screen.queryByText("11")).not.toBeInTheDocument();
  });

  it("hides Players stream when cancelled", () => {
    renderCard({ status: "cancelled" });
    expect(screen.queryByText("João Fernandes")).not.toBeInTheDocument();
  });

  it("shows 'Cancelled' status text below score", () => {
    renderCard({ status: "cancelled" });
    expect(screen.getByTestId("status-chip")).toHaveTextContent(/cancelled/i);
  });
});

describe("HistoryCardFull — admin controls", () => {
  it("shows friendly icon + kebab menu for owner", () => {
    cleanup();
    renderWithTheme(
      <HistoryCardFull
        entry={baseEntry}
        eventId="evt-1"
        event={event}
        cost={cost}
        mvp={mvp}
        isOwner
        isAdmin={false}
        isAuthenticated
        userName="owner"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        knownPlayers={[]}
        playerRatings={[]}
      />,
    );
    expect(screen.getByTestId("friendly-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("more-actions")).toBeInTheDocument();
    // Lock + Delete are inside the kebab menu, not in the header
    expect(screen.queryByTestId("lock-toggle")).not.toBeInTheDocument();
  });

  it("kebab menu reveals Lock and Delete actions for owner", async () => {
    const user = userEvent.setup();
    cleanup();
    renderWithTheme(
      <HistoryCardFull
        entry={baseEntry}
        eventId="evt-1"
        event={event}
        cost={cost}
        mvp={mvp}
        isOwner
        isAdmin={false}
        isAuthenticated
        userName="owner"
        onUpdate={vi.fn()}
        onDelete={vi.fn()}
        knownPlayers={[]}
        playerRatings={[]}
      />,
    );
    await user.click(screen.getByTestId("more-actions"));
    expect(screen.getByTestId("lock-toggle")).toBeInTheDocument();
    expect(screen.getByTestId("delete-action")).toBeInTheDocument();
  });

  it("hides admin controls for non-owner", () => {
    renderCard();
    expect(screen.queryByTestId("friendly-toggle")).not.toBeInTheDocument();
    expect(screen.queryByTestId("more-actions")).not.toBeInTheDocument();
  });
});
