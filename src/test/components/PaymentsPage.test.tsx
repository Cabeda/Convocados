import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import PaymentsPage from "~/components/PaymentsPage";
import { formatShortDate } from "~/lib/money";

function mockFetch(routes: Record<string, unknown>) {
  vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL) => {
    const u = String(url);
    const body = routes[u];
    const headers = new Headers({ "Content-Type": "application/json" });
    if (body === undefined) {
      return Promise.resolve({ ok: false, status: 404, headers, json: async () => ({ error: "not found" }) });
    }
    return Promise.resolve({ ok: true, status: 200, headers, json: async () => body });
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

  it("offers Undo after mark-all-paid and reverts each share", async () => {
    const requests: Array<{ url: string; method?: string; body?: string }> = [];
    vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      requests.push({ url: u, method: init?.method, body: String(init?.body ?? "") });
      const headers = new Headers({ "Content-Type": "application/json" });
      if (u === SETTLEMENT_URL) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers,
          json: async () => summary({
            viewerRole: "owner",
            games: [unsettledGame({
              rows: [
                { eventPlayerId: "ep-b", name: "Bob", amount: 6, status: "pending", isPayer: false },
                { eventPlayerId: "ep-c", name: "Cara", amount: 6, status: "pending", isPayer: false },
              ],
            })],
          }),
        });
      }
      return Promise.resolve({ ok: true, status: 200, headers, json: async () => ({ ok: true, updated: 2 }) });
    }));

    renderWithTheme(<PaymentsPage eventId="e1" />);
    fireEvent.click(await screen.findByRole("button", { name: /mark all paid/i }));

    expect(await screen.findByText("All shares marked paid.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /undo/i }));

    await waitFor(() => {
      const undos = requests.filter((r) => r.method === "POST" && r.url.includes("bulk-undo"));
      expect(undos).toHaveLength(1);
      expect(JSON.parse(undos[0].body!).eventPlayerIds.sort()).toEqual(["ep-b", "ep-c"]);
    });
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

describe("PaymentsPage self-report rows (#1757)", () => {
  const dates = ["2026-08-01T20:00:00Z", "2026-08-08T20:00:00Z"];

  function twoGameSummary() {
    return summary({
      games: [
        unsettledGame({
          gameId: "g1",
          dateTime: dates[0],
          rows: [{ eventPlayerId: "ep-ana", name: "Ana", amount: 6, status: "pending", isPayer: false }],
        }),
        unsettledGame({
          gameId: "g2",
          dateTime: dates[1],
          rows: [{ eventPlayerId: "ep-ana", name: "Ana", amount: 5, status: "pending", isPayer: false }],
        }),
      ],
    });
  }

  it("names each row's game and its own amount so two debts are distinguishable", async () => {
    mockFetch({ [SETTLEMENT_URL]: twoGameSummary() });
    renderWithTheme(<PaymentsPage eventId="e1" />);

    await screen.findAllByRole("button", { name: /report sent/i });
    const rowLabel = (date: string, amount: string) => (_content: string, element: Element | null) =>
      element?.textContent === `${formatShortDate(date)} · ${amount}`;
    expect(screen.getAllByText(rowLabel(dates[0], "6.00€")).length).toBeGreaterThan(0);
    expect(screen.getAllByText(rowLabel(dates[1], "5.00€")).length).toBeGreaterThan(0);
  });

  it("posts the tapped row's own gameId, not the first game's", async () => {
    const selfReports: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
      const u = String(url);
      const headers = new Headers({ "Content-Type": "application/json" });
      if (u === "/api/events/e1/payments/settlement/self-report" && init?.method === "POST") {
        selfReports.push(JSON.parse(String(init.body)));
        return Promise.resolve({ ok: true, status: 200, headers, json: async () => ({ ok: true }) });
      }
      if (u === SETTLEMENT_URL) {
        return Promise.resolve({ ok: true, status: 200, headers, json: async () => twoGameSummary() });
      }
      return Promise.resolve({ ok: false, status: 404, headers, json: async () => ({ error: "not found" }) });
    }));

    renderWithTheme(<PaymentsPage eventId="e1" />);
    fireEvent.click((await screen.findAllByRole("button", { name: /report sent/i }))[0]);
    await waitFor(() => expect(selfReports).toHaveLength(1));
    fireEvent.click((await screen.findAllByRole("button", { name: /report sent/i }))[1]);
    await waitFor(() => expect(selfReports).toHaveLength(2));

    expect(selfReports.map((r) => r.gameId)).toEqual(["g1", "g2"]);
  });

  it("renders self-report rows without duplicate React keys", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mockFetch({ [SETTLEMENT_URL]: twoGameSummary() });
      renderWithTheme(<PaymentsPage eventId="e1" />);
      await screen.findAllByRole("button", { name: /report sent/i });

      const duplicateKey = spy.mock.calls.find(([message]) => /same key|unique "key"/i.test(String(message)));
      expect(duplicateKey).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});
