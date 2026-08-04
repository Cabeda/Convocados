import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PostGameBanner, type PostGameStatus } from "~/components/PostGameBanner";

vi.mock("~/components/MvpVotingCard", () => ({
  MvpVotingCard: () => null,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const baseStatus: PostGameStatus = {
  gameEnded: true,
  hasScore: false,
  hasCost: true,
  allPaid: false,
  allComplete: false,
  isParticipant: true,
  latestHistoryId: "h1",
  paymentsSnapshot: [{ playerName: "Alice", amount: 25, status: "pending" }],
  costCurrency: "EUR",
  costAmount: 50,
  hasPendingPastPayments: false,
  mvpEnabled: false,
  mvpComplete: true,
  bannerMvpComplete: true,
  scoreOne: null,
  scoreTwo: null,
  teamOneName: "A",
  teamTwoName: "B",
};

function mockFetchStatus(status: PostGameStatus | null) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
    ok: true,
    json: async () => status,
  }));
}

describe("PostGameBanner participant gating (issue #658)", () => {
  beforeEach(() => {
    mockFetchStatus(baseStatus);
  });

  it("renders the banner for a participant with pending wrap-up tasks", async () => {
    renderWithTheme(<PostGameBanner eventId="evt1" />);
    await waitFor(() => expect(screen.getByTestId("post-game-banner")).toBeInTheDocument());
  });

  it("renders nothing for a non-participant even when wrap-up tasks are pending", async () => {
    mockFetchStatus({ ...baseStatus, isParticipant: false });
    renderWithTheme(<PostGameBanner eventId="evt1" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("post-game-banner")).not.toBeInTheDocument();
  });

  it("renders nothing for an anonymous user", async () => {
    mockFetchStatus({ ...baseStatus, isParticipant: false, hasScore: false });
    renderWithTheme(<PostGameBanner eventId="evt1" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("post-game-banner")).not.toBeInTheDocument();
  });
});
