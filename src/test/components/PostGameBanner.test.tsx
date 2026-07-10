import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PostGameBanner } from "~/components/PostGameBanner";

(globalThis as any).__APP_VERSION__ = "0.0.0-test";

afterEach(() => cleanup());

function baseStatusResponse(overrides: Record<string, any> = {}) {
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
    editable: false,
    ...overrides,
  };
}

describe("PostGameBanner tap-to-pay routing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("routes a tap on a pending pill in historical (frozen) mode to POST /payments/historical", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => baseStatusResponse({ paymentWriteMode: "historical", editable: false }),
    } as any);
    vi.stubGlobal("fetch", fetchSpy);

    renderWithTheme(<PostGameBanner eventId="evt-1" canEdit />);

    const pill = await screen.findByText(/Kevin/);
    fireEvent.click(pill);

    await waitFor(() => {
      const historicalCall = fetchSpy.mock.calls.find(
        (c) => c[0].includes("/payments/historical") && c[1].method === "POST",
      );
      expect(historicalCall).toBeTruthy();
    });
    const historicalCall = fetchSpy.mock.calls.find(
      (c) => c[0].includes("/payments/historical") && c[1].method === "POST",
    );
    expect(JSON.parse(historicalCall![1].body)).toEqual({
      gameHistoryId: "gh-1",
      playerName: "Kevin",
    });
  });

  it("routes a tap on a live-game pill to PUT /payments with toggled status", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => baseStatusResponse({ paymentWriteMode: "live", latestHistoryId: null }),
    } as any);
    vi.stubGlobal("fetch", fetchSpy);

    renderWithTheme(<PostGameBanner eventId="evt-1" canEdit />);

    const pill = await screen.findByText(/Kevin/);
    fireEvent.click(pill);

    await waitFor(() => {
      const liveCall = fetchSpy.mock.calls.find(
        (c) => c[0].endsWith("/payments") && c[1].method === "PUT",
      );
      expect(liveCall).toBeTruthy();
    });
    const liveCall = fetchSpy.mock.calls.find(
      (c) => c[0].endsWith("/payments") && c[1].method === "PUT",
    );
    expect(JSON.parse(liveCall![1].body)).toEqual({ playerName: "Kevin", status: "paid" });
  });
});

describe("PostGameBanner bidirectional toggle & participant gating", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  it("toggles a pending payment to paid via PATCH /history in editable mode", async () => {
    const response = baseStatusResponse({
      paymentWriteMode: "editable",
      editable: true,
      latestHistoryId: "gh-1",
      isParticipant: true,
      paymentsSnapshot: [{ playerName: "Kevin", amount: 25, status: "pending", method: null }],
    });
    fetchSpy.mockResolvedValue({ ok: true, json: async () => response } as any);

    renderWithTheme(<PostGameBanner eventId="evt-1" canEdit />);

    const pill = await screen.findByText(/Kevin/);
    fireEvent.click(pill);

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        (c) => c[0].includes("/history/gh-1") && c[1].method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
    });
    const patchCall = fetchSpy.mock.calls.find(
      (c) => c[0].includes("/history/gh-1") && c[1].method === "PATCH",
    );
    const body = JSON.parse(patchCall![1].body);
    expect(body.paymentsSnapshot[0].playerName).toBe("Kevin");
    expect(body.paymentsSnapshot[0].status).toBe("paid");
  });

  it("toggles a paid payment back to pending via PATCH /history in editable mode", async () => {
    const response = baseStatusResponse({
      paymentWriteMode: "editable",
      editable: true,
      latestHistoryId: "gh-1",
      isParticipant: true,
      paymentsSnapshot: [{ playerName: "Kevin", amount: 25, status: "paid", method: null }],
    });
    fetchSpy.mockResolvedValue({ ok: true, json: async () => response } as any);

    renderWithTheme(<PostGameBanner eventId="evt-1" canEdit />);

    const pill = await screen.findByText(/Kevin/);
    fireEvent.click(pill);

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        (c) => c[0].includes("/history/gh-1") && c[1].method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
    });
    const patchCall = fetchSpy.mock.calls.find(
      (c) => c[0].includes("/history/gh-1") && c[1].method === "PATCH",
    );
    const body = JSON.parse(patchCall![1].body);
    expect(body.paymentsSnapshot[0].status).toBe("pending");
  });

  it("hides payment chips when user is not a participant and not canEdit", async () => {
    const response = baseStatusResponse({
      paymentWriteMode: "editable",
      editable: true,
      latestHistoryId: "gh-1",
      isParticipant: false,
      paymentsSnapshot: [{ playerName: "Kevin", amount: 25, status: "pending", method: null }],
    });
    fetchSpy.mockResolvedValue({ ok: true, json: async () => response } as any);

    renderWithTheme(<PostGameBanner eventId="evt-1" canEdit={false} />);

    // Chips should not be rendered at all when user can't toggle
    expect(screen.queryByText(/Kevin/)).not.toBeInTheDocument();
  });

  it("allows a participant (isParticipant=true) to toggle even without canEdit", async () => {
    const response = baseStatusResponse({
      paymentWriteMode: "editable",
      editable: true,
      latestHistoryId: "gh-1",
      isParticipant: true,
      paymentsSnapshot: [{ playerName: "Kevin", amount: 25, status: "pending", method: null }],
    });
    fetchSpy.mockResolvedValue({ ok: true, json: async () => response } as any);

    renderWithTheme(<PostGameBanner eventId="evt-1" canEdit={false} />);

    const pill = await screen.findByText(/Kevin/);
    fireEvent.click(pill);

    await waitFor(() => {
      const patchCall = fetchSpy.mock.calls.find(
        (c) => c[0].includes("/history/gh-1") && c[1].method === "PATCH",
      );
      expect(patchCall).toBeTruthy();
    });
  });

  it("allows un-pay in live mode (PUT with status=pending)", async () => {
    const response = baseStatusResponse({
      paymentWriteMode: "live",
      latestHistoryId: null,
      paymentsSnapshot: [{ playerName: "Kevin", amount: 25, status: "paid", method: null }],
    });
    fetchSpy.mockResolvedValue({ ok: true, json: async () => response } as any);

    renderWithTheme(<PostGameBanner eventId="evt-1" canEdit />);

    const pill = await screen.findByText(/Kevin/);
    fireEvent.click(pill);

    await waitFor(() => {
      const putCall = fetchSpy.mock.calls.find(
        (c) => c[0].endsWith("/payments") && c[1].method === "PUT",
      );
      expect(putCall).toBeTruthy();
    });
    const putCall = fetchSpy.mock.calls.find(
      (c) => c[0].endsWith("/payments") && c[1].method === "PUT",
    );
    expect(JSON.parse(putCall![1].body)).toEqual({ playerName: "Kevin", status: "pending" });
  });

  it("does NOT allow un-pay in frozen historical mode (paid chip disabled)", async () => {
    const response = baseStatusResponse({
      paymentWriteMode: "historical",
      editable: false,
      latestHistoryId: "gh-1",
      isParticipant: true,
      paymentsSnapshot: [{ playerName: "Kevin", amount: 25, status: "paid", method: null }],
    });
    fetchSpy.mockResolvedValue({ ok: true, json: async () => response } as any);

    renderWithTheme(<PostGameBanner eventId="evt-1" canEdit />);

    const pill = await screen.findByText(/Kevin/);
    // The chip should be disabled in frozen mode for paid status
    // Clicking it should not trigger any mutation
    fireEvent.click(pill);

    // Allow microtasks to run
    await new Promise((r) => setTimeout(r, 0));
    const mutationCalls = fetchSpy.mock.calls.filter(
      (c) => c[1]?.method === "PATCH" || c[1]?.method === "PUT" || c[1]?.method === "POST",
    );
    expect(mutationCalls).toHaveLength(0);
  });
});