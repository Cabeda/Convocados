import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import PaymentsPage from "~/components/PaymentsPage";

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

const SETTLEMENT_URL = "/api/events/e1/payments/settlement";

function unsettledGame(overrides: Record<string, unknown> = {}) {
  return {
    gameId: "g1",
    dateTime: "2026-08-01T20:00:00Z",
    mode: "tracked",
    payerName: "Ana",
    payerIsPlayer: true,
    total: 12,
    paidCount: 1,
    debtorCount: 2,
    debtorNames: [],
    rows: [],
    ...overrides,
  };
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    games: [unsettledGame()],
    people: [],
    currentGameId: "g1",
    viewerRole: "player",
    viewerEventPlayerId: "ep-ana",
    activePlayerCount: 3,
    maxPlayers: 10,
    totals: { unsettledGames: 1, totalOwed: 12, totalOwedTo: 12 },
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mockFetch({});
});

describe("PaymentsPage settle-all affordance (#1236)", () => {
  it("lets a non-manager payer settle the whole game from the event page", async () => {
    mockFetch({ [SETTLEMENT_URL]: summary({ games: [unsettledGame({ viewerIsPayer: true })] }) });
    renderWithTheme(<PaymentsPage eventId="e1" />);

    const button = await screen.findByRole("button", { name: /mark all paid/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/events/e1/payments/payer-check-in/mark-all-paid",
        expect.objectContaining({ method: "POST" }),
      ),
    );
  });

  it("hides settle-all from a player who is not the payer", async () => {
    mockFetch({ [SETTLEMENT_URL]: summary({ games: [unsettledGame({ viewerIsPayer: false })] }) });
    renderWithTheme(<PaymentsPage eventId="e1" />);

    await screen.findByRole("heading", { name: /unsettled games/i });
    expect(screen.queryByRole("button", { name: /mark all paid/i })).not.toBeInTheDocument();
  });

  it("keeps the manager on the owner/admin settle-all route", async () => {
    mockFetch({ [SETTLEMENT_URL]: summary({ viewerRole: "owner", games: [unsettledGame({ viewerIsPayer: false })] }) });
    renderWithTheme(<PaymentsPage eventId="e1" />);

    const button = await screen.findByRole("button", { name: /mark all paid/i });
    fireEvent.click(button);

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith(
        "/api/events/e1/payments/settlement/bulk",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
  });
});
