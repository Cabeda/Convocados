import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PostGameBanner } from "~/components/PostGameBanner";

(globalThis as any).__APP_VERSION__ = "0.0.0-test";

afterEach(() => cleanup());

function statusResponse(overrides: Record<string, any> = {}) {
  return {
    gameEnded: true,
    hasScore: true,
    hasCost: true,
    allPaid: false,
    allComplete: false,
    isParticipant: false,
    latestHistoryId: "gh-1",
    paymentsSnapshot: [
      { playerName: "Kevin", amount: 25, status: "pending", method: null },
      { playerName: "Alice", amount: 25, status: "paid", method: null },
    ],
    costCurrency: "EUR",
    costAmount: 50,
    paymentWriteMode: "historical" as const,
    hasPendingPastPayments: false,
    mvpEnabled: false,
    mvpComplete: true,
    bannerMvpComplete: true,
    paidAggregate: { paidCount: 1, totalCount: 2 },
    scoreOne: 3,
    scoreTwo: 2,
    teamOneName: "A",
    teamTwoName: "B",
    ...overrides,
  };
}

describe("PostGameBanner tap-to-pay routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("routes a tap on a settled-game pill to POST /payments/historical", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => statusResponse(),
    } as any);
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<PostGameBanner eventId="evt-1" canEdit />);

    // Wait for the status fetch to render the pending pill.
    const pill = await screen.findByText(/Kevin/);
    fireEvent.click(pill);

    await waitFor(() => {
      const historicalCall = fetchMock.mock.calls.find(
        (c) => c[0].includes("/payments/historical") && c[1].method === "POST",
      );
      expect(historicalCall).toBeTruthy();
    });
    const historicalCall = fetchMock.mock.calls.find(
      (c) => c[0].includes("/payments/historical") && c[1].method === "POST",
    );
    expect(JSON.parse(historicalCall![1].body)).toEqual({
      gameHistoryId: "gh-1",
      playerName: "Kevin",
    });
  });

  it("routes a tap on a live-game pill to PUT /payments", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => statusResponse({ paymentWriteMode: "live", latestHistoryId: null }),
    } as any);
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<PostGameBanner eventId="evt-1" canEdit />);

    const pill = await screen.findByText(/Kevin/);
    fireEvent.click(pill);

    await waitFor(() => {
      const liveCall = fetchMock.mock.calls.find(
        (c) => c[0].endsWith("/payments") && c[1].method === "PUT",
      );
      expect(liveCall).toBeTruthy();
    });
    const liveCall = fetchMock.mock.calls.find(
      (c) => c[0].endsWith("/payments") && c[1].method === "PUT",
    );
    expect(JSON.parse(liveCall![1].body)).toEqual({ playerName: "Kevin", status: "paid" });
  });
});
