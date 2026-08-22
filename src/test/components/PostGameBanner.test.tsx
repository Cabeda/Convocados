// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  isPlayer: true,
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
  gamePayments: null,
  gameConfig: null,
};

function mockFetchStatus(status: PostGameStatus | null) {
  vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL) => {
    const u = String(url);
    // Current-game settlement endpoint returns a benign payload in tests.
    if (u.includes("/payments/game")) {
      return Promise.resolve({
        ok: true,
        json: async () => ({ gameId: null, mode: "tracked", payerName: null, payerIsPlayer: false, hasCost: false, rows: [] }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => status,
    });
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

describe("PostGameBanner untracked mode (each one pays own share)", () => {
  beforeEach(() => {
    mockFetchStatus({
      ...baseStatus,
      hasScore: true,
      allPaid: true,
      allComplete: true,
      gamePayments: [],
      gameConfig: { gameId: "g1", mode: "untracked", payerName: null, payerIsPlayer: false },
    });
  });

  it("renders the banner even when allComplete is true (payments done by definition)", async () => {
    renderWithTheme(<PostGameBanner eventId="evt1" />);
    await waitFor(() => expect(screen.getByTestId("post-game-banner")).toBeInTheDocument());
  });

  it("shows the untracked note and no per-player chips", async () => {
    renderWithTheme(<PostGameBanner eventId="evt1" />);
    await waitFor(() => expect(screen.getByTestId("post-game-banner")).toBeInTheDocument());
    expect(screen.getByText(/pays their own share/i)).toBeInTheDocument();
    expect(screen.queryByText(/Alice\s+25\.00/)).not.toBeInTheDocument();
  });

  it("renders the Vote MVP prompt for a player when voting is open", async () => {
    mockFetchStatus({
      ...baseStatus,
      isPlayer: true,
      mvpEnabled: true,
      mvpComplete: false,
      hasScore: true,
      allComplete: false,
      latestHistoryId: "h1",
    });
    renderWithTheme(<PostGameBanner eventId="evt1" />);
    await waitFor(() => expect(screen.getByTestId("post-game-banner")).toBeInTheDocument());
    expect(screen.getByText(/vote mvp/i)).toBeInTheDocument();
  });

  it("hides the Vote MVP prompt for an owner/admin who did not play", async () => {
    mockFetchStatus({
      ...baseStatus,
      isPlayer: false,
      mvpEnabled: true,
      mvpComplete: false,
      hasScore: true,
      allComplete: false,
      latestHistoryId: "h1",
    });
    renderWithTheme(<PostGameBanner eventId="evt1" />);
    await waitFor(() => expect(screen.getByTestId("post-game-banner")).toBeInTheDocument());
    expect(screen.queryByText(/vote mvp/i)).not.toBeInTheDocument();
  });

  it("dismisses the banner for a non-player admin even in untracked mode when allComplete", async () => {
    // A participant who played keeps the untracked wrap-up banner (issue #716).
    // But an Owner/Admin who did NOT play has no wrap-up task left once the game
    // is complete — MVP voting is players-only, so the banner must hide.
    mockFetchStatus({
      ...baseStatus,
      isParticipant: true,
      isPlayer: false,
      hasScore: true,
      allPaid: true,
      allComplete: true,
      mvpEnabled: true,
      mvpComplete: false,
      bannerMvpComplete: true,
      gameEnded: false,
      hasPendingPastPayments: false,
      gamePayments: [],
      gameConfig: { gameId: "g1", mode: "untracked", payerName: null, payerIsPlayer: false },
    });
    renderWithTheme(<PostGameBanner eventId="evt1" />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    expect(screen.queryByTestId("post-game-banner")).not.toBeInTheDocument();
  });

  it("keeps the untracked wrap-up banner for a player who played even when allComplete", async () => {
    mockFetchStatus({
      ...baseStatus,
      isPlayer: true,
      hasScore: true,
      allPaid: true,
      allComplete: true,
      mvpEnabled: true,
      mvpComplete: false,
      bannerMvpComplete: true,
      gameEnded: false,
      hasPendingPastPayments: false,
      gamePayments: [],
      gameConfig: { gameId: "g1", mode: "untracked", payerName: null, payerIsPlayer: false },
    });
    renderWithTheme(<PostGameBanner eventId="evt1" />);
    await waitFor(() => expect(screen.getByTestId("post-game-banner")).toBeInTheDocument());
  });
});
