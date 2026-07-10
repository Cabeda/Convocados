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

  it("renders the 5 tabs (Transactions, Debts, Members, Permissions, Recent activity)", async () => {
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
      expect(screen.getByRole("tab", { name: /Members/ })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Permissions/ })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /Recent activity/ })).toBeInTheDocument();
    });
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

  it("refreshes the UI after declaring a spend (no manual refresh, regression)", async () => {
    const payloadWithAdmin = {
      ...settlePayload,
      admin: {
        balances: [],
        aggregate: { paidCount: 0, totalCount: 0 },
        netPositions: [],
        pairwiseDebts: [],
        subscriptions: [],
      },
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
    await waitFor(() => expect(screen.getByText("Tuesday 5-a-side")).toBeInTheDocument());

    // The declare-spend form lives on the Permissions tab — switch to it.
    fireEvent.click(screen.getByRole("tab", { name: /Permissions/ }));

    const labelInput = screen.getByLabelText(/Label/i);
    const amountInput = screen.getByLabelText(/Amount/i);
    fireEvent.change(labelInput, { target: { value: "Apple fee" } });
    fireEvent.change(amountInput, { target: { value: "10" } });
    fireEvent.click(screen.getByRole("button", { name: /Declare/i }));

    expect(await screen.findByText(/Apple fee/)).toBeInTheDocument();
  });
});
