import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { EventHeader } from "~/components/event/EventHeader";
import type { EventData } from "~/components/event/types";

(globalThis as any).__APP_VERSION__ = "0.0.0-test";

afterEach(() => cleanup());

const baseEvent: EventData = {
  id: "evt-1",
  title: "Tuesday 5-a-side",
  location: "Pitch",
  dateTime: new Date(Date.now() + 86400_000).toISOString(),
  timezone: "Europe/Lisbon",
  maxPlayers: 10,
  durationMinutes: 60,
  teamOneName: "A",
  teamTwoName: "B",
  isRecurring: false,
  isPublic: true,
  balanced: false,
  eloEnabled: false,
  hideEloInTeams: false,
  showCompetitiveData: false,
  splitCostsEnabled: false,
  mvpEnabled: false,
  mvpEloEnabled: false,
  sport: "football-5v5",
  recurrenceRule: null,
  ownerId: null,
  ownerName: null,
  players: [],
  teamResults: [],
  hasPassword: false,
  locked: false,
  archivedAt: null,
  isAdmin: false,
};

const noop = () => Promise.resolve();
const baseProps = {
  eventId: "evt-1",
  event: baseEvent,
  sport: "football-5v5",
  gameDate: new Date(baseEvent.dateTime),
  countdown: "1d",
  canEditSettings: false,
  isOwner: false,
  isAuthenticated: true,
  isOwnerless: true,
  localMatches: null,
  gameStatus: null,
  onSaveTitle: noop,
  onSaveLocation: noop,
  onSaveDateTime: noop,
  onSaveSport: noop,
  onClaimOwnership: noop,
  onCancelGame: () => {},
  onSnackbar: () => {},
};

describe("EventHeader next-game payment chip", () => {
  it("shows a payment chip linking to /settle when the game has a cost", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "c1",
        totalAmount: 50,
        currency: "EUR",
        payments: [],
        effectivePaymentMethods: null,
      }),
    } as any);
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<EventHeader {...baseProps} isOwnerless={false} />);

    const chip = await screen.findByText(/EUR \/ player/);
    expect(chip).toBeInTheDocument();
    const link = chip.closest("a");
    expect(link).toHaveAttribute("href", "/events/evt-1/settle");
  });

  it("does not render the chip when there is no cost", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => null,
    } as any);
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(<EventHeader {...baseProps} isOwnerless={false} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.queryByText(/player/)).not.toBeInTheDocument();
  });

it("shows a Settle Up link in the more-actions menu", async () => {
    renderWithTheme(<EventHeader {...baseProps} isOwnerless={false} />);

    fireEvent.click(screen.getByText(/More/i));

    const settleItem = await screen.findByText(/Settle Up/);
    expect(settleItem.closest("a")).toHaveAttribute("href", "/events/evt-1/settle");
  });
});
