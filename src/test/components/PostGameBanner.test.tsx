import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import React from "react";
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
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

describe("PostGameBanner participant wrap-up editing (issue #679)", () => {
  beforeEach(() => {
    mockFetchStatus(baseStatus);
  });

  it("lets a participant toggle payment chips and reveal the save button", async () => {
    renderWithTheme(<PostGameBanner eventId="evt1" />);
    await waitFor(() => expect(screen.getByTestId("post-game-banner")).toBeInTheDocument());

    const chip = screen.getByText(/Alice\s+25\.00/);
    expect(chip).toBeInTheDocument();

    // Toggling the chip marks the payment paid and surfaces the save control —
    // no owner/admin canEdit flag is required (issue #679).
    fireEvent.click(chip);
    await waitFor(() => expect(screen.getByRole("button", { name: "Save payments" })).toBeInTheDocument());
  });

  it("keeps chips read-only only when there is nothing pending to settle", async () => {
    mockFetchStatus({ ...baseStatus, allPaid: true });
    renderWithTheme(<PostGameBanner eventId="evt1" />);
    await waitFor(() => expect(screen.getByTestId("post-game-banner")).toBeInTheDocument());
    // All paid → inline chips hidden entirely
    expect(screen.queryByText(/Alice\s+25\.00/)).not.toBeInTheDocument();
  });
});
