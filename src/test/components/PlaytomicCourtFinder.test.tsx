/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import PlaytomicCourtFinder from "~/components/PlaytomicCourtFinder";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// The court finder showed a bare `15.5EUR` and, in the list, whatever
// `Intl.NumberFormat` chose (`€15.50`) — two formats on one screen, neither the
// canonical one. This drives the real component to the chip that renders it.
describe("PlaytomicCourtFinder — a court price uses the one money format", () => {
  beforeEach(() => {
    Object.defineProperty(global.navigator, "geolocation", {
      configurable: true,
      value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 1, longitude: 2 } }) },
    });
  });

  it("renders 15.50€ — two decimals, symbol after the amount, no space", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      const body = String(url).includes("/clubs")
        ? { clubs: [{ tenant_id: "t1", tenant_name: "Club One", address: null, coordinate: null, images: [] }] }
        : { courts: [{ resource_id: "r1", resource_name: "Court 1", slots: [
            { start_time: "18:00:00", duration: 60, price: 15.5, currency: "EUR" },
          ] }] };
      return { ok: true, json: async () => body } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(
      <PlaytomicCourtFinder open sport="padel" date="2026-01-01" onClose={vi.fn()} onSelect={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Search nearby courts/i }));
    await userEvent.click(await screen.findByText("Club One"));

    expect(await screen.findByText(/18:00 - 15\.50€/)).toBeInTheDocument();
  });

  it("renders an unknown currency as its own code rather than a guessed symbol", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const body = String(url).includes("/clubs")
        ? { clubs: [{ tenant_id: "t1", tenant_name: "Club One", address: null, coordinate: null, images: [] }] }
        : { courts: [{ resource_id: "r1", resource_name: "Court 1", slots: [
            { start_time: "18:00:00", duration: 60, price: 15.5, currency: "SEK" },
          ] }] };
      return { ok: true, json: async () => body } as unknown as Response;
    }));

    renderWithTheme(
      <PlaytomicCourtFinder open sport="padel" date="2026-01-01" onClose={vi.fn()} onSelect={vi.fn()} />,
    );

    await userEvent.click(screen.getByRole("button", { name: /Search nearby courts/i }));
    await userEvent.click(await screen.findByText("Club One"));

    expect(await screen.findByText(/18:00 - 15\.50SEK/)).toBeInTheDocument();
  });
});
