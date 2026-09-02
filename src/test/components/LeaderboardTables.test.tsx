import { describe, expect, it, vi } from "vitest";
import { screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { LeaderboardTables, type LeaderboardPayload } from "~/components/LeaderboardTables";

const data: LeaderboardPayload = {
  scope: { type: "season", seasonId: "season-1", name: "Spring League", startsAt: null, endsAt: null },
  gamesCount: 4,
  players: [{ rank: 1, name: "Alice", points: 10, played: 4, wins: 3, draws: 1, losses: 0, goalsFor: 12, goalsAgainst: 4, goalDifference: 8 }],
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
    renderWithTheme(<LeaderboardTables data={data} loading={false} selectedScopeId="active" seasonOptions={[{ id: "cancelled", name: "Cancelled League", status: "cancelled" }, { id: "active", name: "Active League", status: "active" }]} onScopeChange={vi.fn()} />);
    const comboboxes = screen.getAllByRole("combobox");
    fireEvent.mouseDown(comboboxes[comboboxes.length - 1]);

    expect(screen.queryByRole("option", { name: "Cancelled League" })).not.toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Active League" })).toBeInTheDocument();
  });
});
