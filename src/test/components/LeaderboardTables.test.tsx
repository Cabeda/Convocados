import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { LeaderboardTables, type LeaderboardPayload } from "~/components/LeaderboardTables";

afterEach(() => {
  cleanup();
});

const data: LeaderboardPayload = {
  scope: { type: "season", seasonId: "season-1", name: "Spring League", startsAt: null, endsAt: null },
  gamesCount: 4,
  players: [{ rank: 1, name: "Alice", crewName: "Red", points: 10, played: 4, wins: 3, draws: 1, losses: 0, goalsFor: 12, goalsAgainst: 4, goalDifference: 8 }],
  crews: [{
    rank: 1,
    name: "Red",
    crewId: "crew-1",
    points: 10,
    tieBreakTotal: 10,
    roundsRepresented: 4,
    roundsCounted: 4,
    gameScores: [
      { gameId: "g1", score: 3, counted: true },
      { gameId: "g2", score: 3, counted: true },
      { gameId: "g3", score: 3, counted: true },
      { gameId: "g4", score: 1, counted: true },
    ],
  }],
};

describe("LeaderboardTables", () => {
  it("renders player and Crew leagues with their statistics", () => {
    renderWithTheme(<LeaderboardTables data={data} loading={false} selectedScopeId="season-1" seasonOptions={[{ id: "season-1", name: "Spring League", status: "completed" }]} onScopeChange={vi.fn()} />);

    expect(screen.getByText("Standings")).toBeInTheDocument();
    expect(screen.getByText("Player league")).toBeInTheDocument();
    expect(screen.getByText("Crew league")).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Player" })).toBeInTheDocument();
    expect(screen.getByRole("table", { name: "Crew" })).toBeInTheDocument();
    // Player league keeps football points; Crew league shows its best-six total to 2 decimals.
    expect(screen.getByText("10")).toBeInTheDocument();
    expect(screen.getByText("+8")).toBeInTheDocument();
    expect(screen.getByText("10.00")).toBeInTheDocument();
    expect(screen.getByText("4/4")).toBeInTheDocument();
    // Player league shows each player's Crew next to the name; "Red" also
    // appears as the Crew league row, so expect at least two occurrences.
    expect(screen.getAllByText("Red").length).toBeGreaterThanOrEqual(2);
  });

  it("explains when no Crew standings exist", () => {
    renderWithTheme(<LeaderboardTables data={{ ...data, crews: [] }} loading={false} selectedScopeId="all" seasonOptions={[]} onScopeChange={vi.fn()} />);
    expect(screen.getByText("No Crew standings are available for this scope.")).toBeInTheDocument();
  });

  it("explains when competitive data is hidden", () => {
    renderWithTheme(<LeaderboardTables data={{ ...data, hidden: true }} loading={false} selectedScopeId="season-1" seasonOptions={[]} onScopeChange={vi.fn()} />);
    expect(screen.getByText("Competitive standings are hidden for this event.")).toBeInTheDocument();
  });

  it("does not offer cancelled Seasons as a leaderboard scope", () => {
    const { unmount } = renderWithTheme(<LeaderboardTables data={data} loading={false} selectedScopeId="active" seasonOptions={[{ id: "cancelled", name: "Cancelled League", status: "cancelled" }, { id: "active", name: "Active League", status: "active" }]} onScopeChange={vi.fn()} />);
    const comboboxes = screen.getAllByRole("combobox");
    fireEvent.mouseDown(comboboxes[comboboxes.length - 1]);

    expect(screen.queryByRole("option", { name: "Cancelled League" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Active League" })).toBeInTheDocument();

    // Close the MUI menu and unmount synchronously: React 19 schedules menu
    // transition work outside act(), which otherwise flushes after jsdom
    // teardown and fails the run with an unhandled "window is not defined".
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    unmount();
  });
});

describe("LeaderboardTables — mobile crew standings", () => {
  const originalMatchMedia = window.matchMedia;

  beforeEach(() => {
    window.matchMedia = ((query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  });

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
  });

  it("renders the standings as cards instead of wide tables", () => {
    renderWithTheme(<LeaderboardTables data={data} loading={false} selectedScopeId="season-1" seasonOptions={[]} onScopeChange={vi.fn()} />);

    expect(screen.getByTestId("crew-standings-mobile")).toBeInTheDocument();
    expect(screen.getByTestId("player-standings-mobile")).toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Crew" })).not.toBeInTheDocument();
    expect(screen.queryByRole("table", { name: "Player" })).not.toBeInTheDocument();
    expect(screen.getAllByText("Red").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("10.00")).toBeInTheDocument();
    expect(screen.getByText(/4\/4/)).toBeInTheDocument();
    // Game score chips still render.
    expect(screen.getByLabelText(/Game scores 1: 3\.00/)).toBeInTheDocument();
  });
});
