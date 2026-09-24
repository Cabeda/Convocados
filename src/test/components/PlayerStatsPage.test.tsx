/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

vi.mock("~/lib/auth.client", () => ({
  useSession: () => ({ data: { user: { id: "u1", name: "Alice" } }, isPending: false }),
}));

import PlayerStatsPage from "~/components/PlayerStatsPage";

const statsPayload = {
  summary: {
    totalGames: 10,
    totalWins: 6,
    totalDraws: 1,
    totalLosses: 3,
    winRate: 0.6,
    avgRating: 1100,
    bestRating: 1250,
    eventsPlayed: 2,
    totalMvpAwards: 1,
    totalGoals: 7,
    totalAssists: 4,
  },
  events: [
    {
      eventId: "e1",
      eventTitle: "Monday Futsal",
      sport: "futsal",
      rating: 1150,
      gamesPlayed: 6,
      wins: 4,
      draws: 1,
      losses: 1,
      winRate: 0.67,
      attendance: { gamesPlayed: 6, totalGames: 6, attendanceRate: 1, currentStreak: 3 },
      mvpAwards: 1,
      goals: 5,
      assists: 3,
    },
  ],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => statsPayload,
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PlayerStatsPage goals & assists (GH #1087)", () => {
  it("shows total goals and assists in the summary", async () => {
    render(<PlayerStatsPage />);

    await waitFor(() => expect(screen.getByText("Monday Futsal")).toBeTruthy());
    const goals = screen.getAllByText("Goals");
    const assists = screen.getAllByText("Assists");
    expect(goals.length).toBeGreaterThan(0);
    expect(assists.length).toBeGreaterThan(0);
    // Summary row: total goals then total assists (7 / 4).
    const goalCard = goals[0].closest("div")!.parentElement!;
    const assistCard = assists[0].closest("div")!.parentElement!;
    expect(goalCard.textContent).toContain("7");
    expect(assistCard.textContent).toContain("4");
  });

  it("lists per-event goals and assists", async () => {
    render(<PlayerStatsPage />);

    await waitFor(() => expect(screen.getByText("Monday Futsal")).toBeTruthy());
    const row = screen.getByText("Monday Futsal").closest("tr")!;
    expect(row.textContent).toContain("5"); // per-event goals
    expect(row.textContent).toContain("3"); // per-event assists
  });
});