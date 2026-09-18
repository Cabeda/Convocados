import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { EventHeader } from "~/components/event/EventHeader";
import type { EventData } from "~/components/event/types";

// Stub heavy children so the test focuses on the menu gating, not their data fetching.
vi.mock("~/components/event/ShareBar", () => ({ ShareBar: () => null }));
vi.mock("~/components/event/NotifyButton", () => ({ NotifyButton: () => null }));
vi.mock("~/components/PaymentSurface", () => ({ PaymentSurface: () => null }));
vi.mock("~/components/event/MyNotificationsDialog", () => ({ MyNotificationsDialog: () => null }));
vi.mock("~/components/LocationAutocomplete", () => ({ default: () => null, reverseGeocode: vi.fn() }));
vi.mock("~/components/CourtAlternatives", () => ({ default: () => null }));

const baseEvent: EventData = {
  id: "evt-1",
  title: "Monday Football",
  location: "Campo",
  dateTime: new Date(Date.now() + 3 * 86400_000).toISOString(),
  timezone: "UTC",
  maxPlayers: 10,
  durationMinutes: 60,
  teamOneName: "Ninjas",
  teamTwoName: "Gunas",
  isRecurring: false,
  isPublic: true,
  balanced: true,
  eloEnabled: true,
  hideEloInTeams: true,
  showCompetitiveData: true,
  splitCostsEnabled: true,
  mvpEnabled: true,
  mvpEloEnabled: false,
  sport: "football-5v5",
  recurrenceRule: null,
  ownerId: "owner-1",
  ownerName: "Owner",
  players: [],
  teamResults: [],
} as EventData;

function renderHeader(props: Partial<{ canEditSettings: boolean; isOwner: boolean; isOwnerless: boolean }> = {}) {
  const {
    canEditSettings = true,
    isOwner = true,
    isOwnerless = false,
  } = props;
  return renderWithTheme(
    <EventHeader
      eventId="evt-1"
      event={baseEvent}
      sport="football-5v5"
      gameDate={new Date(baseEvent.dateTime)}
      countdown="in 3 days"
      canEditSettings={canEditSettings}
      isOwner={isOwner}
      isAuthenticated
      isOwnerless={isOwnerless}
      localMatches={null}
      gameStatus={null}
      onSaveTitle={async () => {}}
      onSaveLocation={async () => {}}
      onSaveDateTime={async () => {}}
      onSaveSport={async () => {}}
      onClaimOwnership={async () => {}}
      onCancelGame={() => {}}
      onSnackbar={() => {}}
    />
  );
}

async function openMoreMenu() {
  fireEvent.click(screen.getByRole("button", { name: /^more/i }));
  await screen.findAllByRole("menuitem");
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("EventHeader — Skill Rating menu visibility", () => {
  it("shows the Skill Rating link to the owner/admin", async () => {
    renderHeader({ canEditSettings: true, isOwner: true, isOwnerless: false });
    await openMoreMenu();
    expect(await screen.findByRole("menuitem", { name: /skill rating/i })).toBeInTheDocument();
  });

  it("hides the Skill Rating link from a plain player", async () => {
    renderHeader({ canEditSettings: false, isOwner: false, isOwnerless: false });
    await openMoreMenu();
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: /skill rating/i })).not.toBeInTheDocument());
  });

  it("hides the Skill Rating link on an ownerless event", async () => {
    renderHeader({ canEditSettings: true, isOwner: false, isOwnerless: true });
    await openMoreMenu();
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: /skill rating/i })).not.toBeInTheDocument());
  });
});
