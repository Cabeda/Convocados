import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import SettleUpPage from "~/components/SettleUpPage";

(globalThis as any).__APP_VERSION__ = "0.0.0-test";

beforeEach(() => {
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

describe("SettleUpPage Status view", () => {
  it("renders the Status content without a History tab", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => settlePayload } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);

    await waitFor(() => expect(screen.getByText(/Settle/i)).toBeInTheDocument());
    // The game-history drill-down tab is gone — no History tab.
    expect(screen.queryByRole("tab", { name: /History/i })).not.toBeInTheDocument();
    // Status content renders the "You" summary.
    expect(screen.getByText("Kevin")).toBeInTheDocument();
  });

  it("shows a Change method button in the Status view (fixes invisible bug)", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => settlePayload } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);

    await waitFor(() => expect(screen.getByText(/Change method/)).toBeInTheDocument());
  });

  it("refreshes the UI after declaring a spend (no manual refresh)", async () => {
    const payloadWithAdmin = {
      ...settlePayload,
      admin: { balances: [], aggregate: { paidCount: 0, totalCount: 0 }, subscriptions: [] },
    };
    let settleCalls = 0;
    const fetchMock = vi.fn((url: string, init?: any) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      if (url.includes("/settle/extras") && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({}) } as any);
      }
      // GET /settle — return the declared spend on the second load.
      settleCalls += 1;
      const declared = settleCalls > 1
        ? {
            ...payloadWithAdmin,
            extras: {
              ...payloadWithAdmin.extras,
              declarations: [{
                id: "d1", amountCents: 1000, currency: "EUR",
                label: "Apple fee", declaredBy: "u-owner", declaredAt: new Date().toISOString(),
              }],
            },
          }
        : payloadWithAdmin;
      return Promise.resolve({ ok: true, json: async () => declared } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);
    await waitFor(() => expect(screen.getByText(/Settle/i)).toBeInTheDocument());

    const labelInput = screen.getByLabelText(/Label/i);
    const amountInput = screen.getByLabelText(/Amount/i);
    fireEvent.change(labelInput, { target: { value: "Apple fee" } });
    fireEvent.change(amountInput, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /Declare/i }));

    // The declared spend appears in the UI without a manual refresh.
    expect(await screen.findByText(/Apple fee/)).toBeInTheDocument();
  });
});
