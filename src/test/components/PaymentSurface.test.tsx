// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PaymentSurface } from "~/components/PaymentSurface";
import { CostSection } from "~/components/CostSection";

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL) => {
    const u = String(url);
    const body = routes[u];
    if (body === undefined) {
      return Promise.resolve({ ok: false, status: 404, json: async () => ({ error: "not found" }) });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => body });
  }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mockFetch({});
});

describe("PaymentSurface", () => {
  it("shows the price line and a View payments link", async () => {
    mockFetch({
      "/api/events/e1/cost": { totalAmount: 50, currency: "EUR", effectivePaymentMethods: null },
      "/api/events/e1/payments/settlement": {
        people: [], viewerEventPlayerId: null, viewerRole: "owner",
      },
    });
    renderWithTheme(<PaymentSurface eventId="e1" canEdit isAuthenticated maxPlayers={10} />);
    await waitFor(() => expect(screen.getByText(/50.00EUR/)).toBeInTheDocument());
    expect(screen.getByText(/per player/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /view payments/i })).toBeInTheDocument();
  });

  it("per-player share is total / maxPlayers (required slots), not total / current players", async () => {
    mockFetch({
      "/api/events/e1/cost": { totalAmount: 50, currency: "EUR", effectivePaymentMethods: null },
      "/api/events/e1/payments/settlement": {
        people: [], viewerEventPlayerId: null, viewerRole: "owner",
      },
    });
    renderWithTheme(<PaymentSurface eventId="e1" canEdit isAuthenticated maxPlayers={10} />);
    await waitFor(() => expect(screen.getByText(/5.00EUR/)).toBeInTheDocument());
  });

  it("shows the you-owe CTA to a player with debt (not to the owner)", async () => {
    mockFetch({
      "/api/events/e1/cost": { totalAmount: 50, currency: "EUR", effectivePaymentMethods: null },
      "/api/events/e1/payments/settlement": {
        people: [{ name: "Ana", isPlayer: true, owedAmount: 10, lines: [{ gameId: "g1", dateTime: "2026-08-01T00:00:00Z", amount: 10, status: "pending", role: "debtor" }] }],
        viewerEventPlayerId: "ep1", viewerRole: "player",
      },
    });
    renderWithTheme(<PaymentSurface eventId="e1" canEdit={false} isAuthenticated maxPlayers={10} />);
    await waitFor(() => expect(screen.getByText(/You owe 10.00EUR/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /report sent/i })).toBeInTheDocument();
  });

  it("renders nothing for anonymous users", () => {
    mockFetch({
      "/api/events/e1/cost": { totalAmount: 50, currency: "EUR", effectivePaymentMethods: null },
      "/api/events/e1/payments/settlement": { people: [], viewerEventPlayerId: null, viewerRole: "player" },
    });
    renderWithTheme(<PaymentSurface eventId="e1" canEdit={false} isAuthenticated={false} maxPlayers={10} />);
    expect(screen.queryByText(/50.00EUR/)).not.toBeInTheDocument();
  });
});

describe("CostSection", () => {
  it("shows the price and an Edit button for a manager", async () => {
    mockFetch({ "/api/events/e1/cost": { totalAmount: 80, currency: "EUR", paymentMethods: null, effectivePaymentMethods: null, hasOverride: false } });
    renderWithTheme(<CostSection eventId="e1" isManager maxPlayers={10} />);
    await waitFor(() => expect(screen.getByText(/80.00EUR/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /edit price/i })).toBeInTheDocument();
  });

  it("shows per-player share = total / maxPlayers", async () => {
    mockFetch({ "/api/events/e1/cost": { totalAmount: 50, currency: "EUR", paymentMethods: null, effectivePaymentMethods: null, hasOverride: false } });
    renderWithTheme(<CostSection eventId="e1" isManager={false} maxPlayers={10} />);
    await waitFor(() => expect(screen.getByText(/5.00EUR/)).toBeInTheDocument());
  });

  it("hides the Edit button for a regular player", async () => {
    mockFetch({ "/api/events/e1/cost": { totalAmount: 80, currency: "EUR", paymentMethods: null, effectivePaymentMethods: null, hasOverride: false } });
    renderWithTheme(<CostSection eventId="e1" isManager={false} maxPlayers={10} />);
    await waitFor(() => expect(screen.getByText(/80.00EUR/)).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /edit price/i })).not.toBeInTheDocument();
  });

  it("saves a price edit through the dialog", async () => {
    mockFetch({
      "/api/events/e1/cost": { totalAmount: 80, currency: "EUR", paymentMethods: null, effectivePaymentMethods: null, hasOverride: false },
    });
    renderWithTheme(<CostSection eventId="e1" isManager maxPlayers={10} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /edit price/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /edit price/i }));
    await waitFor(() => expect(screen.getByRole("dialog")).toBeInTheDocument());

    const saveBtn = screen.getByRole("button", { name: /save/i });
    fireEvent.click(saveBtn);
    const fetchMock = vi.mocked(fetch);
    const putCall = fetchMock.mock.calls.find(([, init]) => init && (init as RequestInit).method === "PUT");
    expect(putCall).toBeTruthy();
    expect(String(putCall![0])).toContain("/cost");
  });
});
