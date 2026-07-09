import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import SettleUpPage from "~/components/SettleUpPage";

(globalThis as any).__APP_VERSION__ = "0.0.0-test";

beforeEach(() => {
  // The page persists the active tab in the URL (?tab=). Reset between tests
  // so each render starts on the default (Status) tab.
  window.history.replaceState({}, "", "/");
});
afterEach(() => cleanup());

const settlePayload = {
  event: {
    id: "evt-1",
    title: "Tuesday 5-a-side",
    timezone: "Europe/Lisbon",
    currency: "EUR",
    monthlyEnabled: false,
    monthlyFeeCents: null,
    monthlyGamesCovered: 0,
    dropInSurchargeCents: 0,
    ownerId: "u-owner",
  },
  extras: { potCents: 0, currency: "EUR", declarations: [] },
  you: {
    playerName: "Kevin",
    balanceCents: 500,
    gamesOwed: 1,
    streak: 0,
    availableGameUnits: 0,
    transactions: [],
    walletRunningTotal: 0,
    activeSubscription: null,
  },
};

const historyResponse = {
  data: [
    {
      id: "gh-1",
      dateTime: new Date().toISOString(),
      status: "played",
      paymentsSnapshot: JSON.stringify([
        { playerName: "Kevin", amount: 25, status: "pending", method: null },
        { playerName: "Alice", amount: 25, status: "paid", method: null },
      ]),
    },
  ],
  nextCursor: null,
  hasMore: false,
};

describe("SettleUpPage 2-tab restructure", () => {
  it("renders Status and History tabs", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/history")) {
        return Promise.resolve({ ok: true, json: async () => historyResponse } as any);
      }
      return Promise.resolve({ ok: true, json: async () => settlePayload } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);

    await waitFor(() => expect(screen.getByText(/Status/)).toBeInTheDocument());
    expect(screen.getAllByText(/History/).length).toBeGreaterThan(0);
  });

  it("switches to the History tab and shows past games", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/history")) {
        return Promise.resolve({ ok: true, json: async () => historyResponse } as any);
      }
      return Promise.resolve({ ok: true, json: async () => settlePayload } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);

    const historyTab = await screen.findAllByText(/History/);
    fireEvent.click(historyTab[historyTab.length - 1].closest("button") ?? historyTab[historyTab.length - 1]);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("/history")));
    expect(await screen.findByText(/Kevin/)).toBeInTheDocument();
  });

  it("shows a Change method button in the Status tab (fixes invisible bug)", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/history")) {
        return Promise.resolve({ ok: true, json: async () => historyResponse } as any);
      }
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => settlePayload } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);

    await waitFor(() => expect(screen.getByText(/Change method/)).toBeInTheDocument());
  });
});
