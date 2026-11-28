/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { CostSection } from "~/components/CostSection";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  mockFetch({});
});

describe("CostSection", () => {
  it("shows the price and an Edit button for a manager", async () => {
    mockFetch({ "/api/events/e1/cost": { totalAmount: 80, currency: "EUR", paymentMethods: null, effectivePaymentMethods: null, hasOverride: false } });
    renderWithTheme(<CostSection eventId="e1" isManager maxPlayers={10} />);
    await waitFor(() => expect(screen.getByText(/80.00€/)).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /edit price/i })).toBeInTheDocument();
  });

  it("shows per-player share = total / maxPlayers", async () => {
    mockFetch({ "/api/events/e1/cost": { totalAmount: 50, currency: "EUR", paymentMethods: null, effectivePaymentMethods: null, hasOverride: false } });
    renderWithTheme(<CostSection eventId="e1" isManager={false} maxPlayers={10} />);
    await waitFor(() => expect(screen.getByText(/5.00€/)).toBeInTheDocument());
  });

  it("hides the Edit button for a regular player", async () => {
    mockFetch({ "/api/events/e1/cost": { totalAmount: 80, currency: "EUR", paymentMethods: null, effectivePaymentMethods: null, hasOverride: false } });
    renderWithTheme(<CostSection eventId="e1" isManager={false} maxPlayers={10} />);
    await waitFor(() => expect(screen.getByText(/80.00€/)).toBeInTheDocument());
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
