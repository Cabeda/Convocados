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

describe("SettleUpPage redesigned view", () => {
  it("renders the SettleHero with the event title (no more legacy 'Settle Up' header)", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => settlePayload } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);

    await waitFor(() => expect(screen.getByText("Tuesday 5-a-side")).toBeInTheDocument());
  });

  it("shows a Change method button (still wired to the override dialog)", async () => {
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

  it("only shows the Transactions and Debts tabs (Members/Permissions/Recent activity were removed)", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => settlePayload } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);

    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Transactions/ })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Debts/ })).toBeInTheDocument();
    });
    expect(screen.queryByRole("tab", { name: /Members/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Permissions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: /Recent activity/ })).not.toBeInTheDocument();
  });

  it("never shows 'Log in to see your activity' anywhere on the page", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => settlePayload } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);
    await waitFor(() => expect(screen.getByText("Tuesday 5-a-side")).toBeInTheDocument());
    // The misleading "Log in" copy was removed along with the ActivityTab.
    expect(screen.queryByText(/log in to see/i)).not.toBeInTheDocument();
  });

  it("Transactions tab shows the unified transactions list with filter chips and an Add button", async () => {
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      if (url.includes("/settle/transactions")) {
        return Promise.resolve({ ok: true, json: async () => ({ transactions: [] }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => settlePayload } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);
    await waitFor(() => expect(screen.getByText("Tuesday 5-a-side")).toBeInTheDocument());
    // Switch to Transactions tab
    fireEvent.click(screen.getByRole("tab", { name: /Transactions/ }));
    // Filter chips visible
    expect(screen.getByTestId("txn-filter-all")).toBeInTheDocument();
    expect(screen.getByTestId("txn-filter-game")).toBeInTheDocument();
    expect(screen.getByTestId("txn-filter-subscription")).toBeInTheDocument();
    expect(screen.getByTestId("txn-filter-spend")).toBeInTheDocument();
    // Add button visible
    expect(screen.getByTestId("add-transaction-button")).toBeInTheDocument();
    // The old misleading "Payments tab on the event page" copy is gone.
    expect(screen.queryByText(/Payments tab on the event page/i)).not.toBeInTheDocument();
  });

  it("renders the SettleHero bubble graph when admin data has netPositions", async () => {
    const payloadWithAdmin = {
      ...settlePayload,
      admin: {
        balances: [],
        aggregate: { paidCount: 0, totalCount: 0 },
        netPositions: [
          { playerName: "Pai", netCents: -257800 },
          { playerName: "José", netCents: 257800 },
        ],
        pairwiseDebts: [
          { fromName: "Pai", toName: "José", amountCents: 257800 },
        ],
        subscriptions: [],
      },
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => payloadWithAdmin } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    const { container } = renderWithTheme(<SettleUpPage eventId="evt-1" />);
    await waitFor(() => expect(screen.getByText("Tuesday 5-a-side")).toBeInTheDocument());
    // Two bubbles expected (one per net position).
    expect(container.querySelectorAll('[data-testid^="bubble-group-"]')).toHaveLength(2);
  });

  it("renders the DebtsList inside the active Debts tab by default", async () => {
    const payloadWithAdmin = {
      ...settlePayload,
      admin: {
        balances: [],
        aggregate: { paidCount: 0, totalCount: 0 },
        netPositions: [
          { playerName: "Pai", netCents: -257800 },
          { playerName: "José", netCents: 257800 },
        ],
        pairwiseDebts: [
          { fromName: "Pai", toName: "José", amountCents: 277760 },
        ],
        subscriptions: [],
      },
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => payloadWithAdmin } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);
    await waitFor(() => expect(screen.getByTestId("debts-list")).toBeInTheDocument());
    expect(screen.getByTestId("debt-row-Pai-José")).toBeInTheDocument();
  });

  it("sends creditorName in the bulk settle request so the API can authorize the creditor", async () => {
    const payloadWithAdmin = {
      ...settlePayload,
      admin: {
        balances: [],
        aggregate: { paidCount: 0, totalCount: 0 },
        netPositions: [
          { playerName: "Pai", netCents: -257800 },
          { playerName: "José", netCents: 257800 },
        ],
        pairwiseDebts: [
          { fromName: "Pai", toName: "José", amountCents: 277760 },
        ],
        subscriptions: [],
      },
    };
    const fetchMock = vi.fn((url: string, init?: any) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      if (url.includes("/payments/historical/bulk") && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, settled: 1, skipped: 0, failed: 0 }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => payloadWithAdmin } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);
    await waitFor(() => expect(screen.getByTestId("debt-row-Pai-José")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("debt-row-Pai-José"));
    fireEvent.click(screen.getByTestId("debt-action-mark-settled"));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) => typeof url === "string" && url.includes("/payments/historical/bulk") && init?.method === "POST",
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse((putCall?.[1] as any).body);
      // The frontend MUST send creditorName so the backend can authorize
      // the creditor (and reject the debtor from marking themselves paid).
      expect(body.creditorName).toBe("José");
      expect(body.playerName).toBe("Pai");
    });
  });

  it("opens the context menu on the creditor avatar (Mark settled / Remind / Generate QR)", async () => {
    const payloadWithAdmin = {
      ...settlePayload,
      admin: {
        balances: [],
        aggregate: { paidCount: 0, totalCount: 0 },
        netPositions: [
          { playerName: "Pai", netCents: -257800 },
          { playerName: "José", netCents: 257800 },
        ],
        pairwiseDebts: [
          { fromName: "Pai", toName: "José", amountCents: 277760 },
        ],
        subscriptions: [],
      },
    };
    const fetchMock = vi.fn((url: string) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => payloadWithAdmin } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);
    await waitFor(() => expect(screen.getByTestId("debts-list")).toBeInTheDocument());
    fireEvent.click(screen.getByTestId("creditor-avatar-José"));
    expect(screen.getByTestId("debt-action-mark-settled")).toBeInTheDocument();
    expect(screen.getByTestId("debt-action-remind")).toBeInTheDocument();
    expect(screen.getByTestId("debt-action-generate-qr")).toBeInTheDocument();
  });

  it("refreshes the UI after settling a debt (no manual refresh, regression)", async () => {
    // Regression: the "Mark debt as settled" action must re-fetch the data
    // and remove the row from the list. The declare-spend form was removed
    // along with the Permissions tab, so this test now exercises the
    // remaining live-mutation flow.
    const payloadWithAdmin = {
      ...settlePayload,
      admin: {
        balances: [],
        aggregate: { paidCount: 0, totalCount: 0 },
        netPositions: [
          { playerName: "Pai", netCents: -257800 },
          { playerName: "José", netCents: 257800 },
        ],
        pairwiseDebts: [
          { fromName: "Pai", toName: "José", amountCents: 257800 },
        ],
        subscriptions: [],
      },
    };
    let settleCalls = 0;
    const fetchMock = vi.fn((url: string, init?: any) => {
      if (url.includes("/cost")) {
        return Promise.resolve({ ok: true, json: async () => ({ paymentMethods: null, tempPaymentMethods: null }) } as any);
      }
      if (url.includes("/payments/historical/bulk") && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true, settled: 1, skipped: 0, failed: 0 }) } as any);
      }
      // GET /settle — second load has no debts.
      settleCalls += 1;
      const data = settleCalls > 1
        ? { ...payloadWithAdmin, admin: { ...payloadWithAdmin.admin, pairwiseDebts: [], netPositions: [] } }
        : payloadWithAdmin;
      return Promise.resolve({ ok: true, json: async () => data } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<SettleUpPage eventId="evt-1" />);
    await waitFor(() => expect(screen.getByTestId("debt-row-Pai-José")).toBeInTheDocument());

    // Open the menu by clicking anywhere on the row and pick "Mark settled".
    fireEvent.click(screen.getByTestId("debt-row-Pai-José"));
    fireEvent.click(await screen.findByTestId("debt-action-mark-settled"));

    // The data refetches; the row disappears.
    await waitFor(() => expect(screen.queryByTestId("debt-row-Pai-José")).not.toBeInTheDocument());
  });
});
