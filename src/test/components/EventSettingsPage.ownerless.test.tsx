// GH-1393 — an ownerless PUBLIC Event (an Open Pickup) must render its settings
// controls disabled, because the server rejects every mutation on it until it is
// adopted (ADR 0035). The screen re-derived the rule as
// `isOwnerless || isOwner || isAdmin`, dropping the `!isPublic` term, so the
// controls looked editable and each save came back rejected.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";

// A stable object: a fresh session per render re-triggers the load effects.
const mockSession = {
  data: { user: { id: "u-1", name: "Sam" } },
  isPending: false,
  refetch: vi.fn(),
};
vi.mock("~/lib/auth.client", () => ({
  useSession: () => mockSession,
  signOut: vi.fn(),
}));

import EventSettingsPage from "~/components/EventSettingsPage";

const baseEvent = {
  title: "Monday Football",
  ownerId: null as string | null,
  isPublic: false,
  balanced: true,
  eloEnabled: true,
  rankEnabled: true,
  hideEloInTeams: false,
  showCompetitiveData: true,
  allowManualRating: true,
  rankDecayEnabled: false,
  inactiveRankBehavior: "freeze",
  splitCostsEnabled: true,
  mvpEnabled: true,
  mvpEloEnabled: false,
  sport: "football-5v5",
  isRecurring: false,
  durationMinutes: 90,
  archivedAt: null,
  isAdmin: false,
};

/** The page fetches /api/events/:id, /priority, /access, /access/invites and /admins on mount. */
function routeFetch(event: Record<string, unknown>) {
  const handlers: Record<string, unknown> = {
    "/priority": { settings: null, enrollments: [], eligible: [], ineligible: [], maxSlots: 0 },
    "/access/invites": [],
    "/admins/candidates": [],
    "/admins": [],
    "/access": { hasPassword: false },
    "/api/events/evt-1": event,
  };
  return vi.fn(async (url: string) => {
    for (const [pattern, body] of Object.entries(handlers)) {
      if (String(url).includes(pattern)) return Response.json(body);
    }
    return Response.json([]);
  });
}

/**
 * The settings controls that carry the `canEdit` gate. Switches are the ones that
 * apply a change optimistically and then fail on the server, so they matter most;
 * the duration field is here as a control of a second kind.
 */
function settingsControls() {
  return {
    publicToggle: screen.getByRole("switch", { name: /visible on the public games page/i }),
    competitionToggle: screen.getByRole("switch", { name: /seasonal Rank ladder/i }),
    durationField: screen.getByRole("spinbutton"),
  };
}

async function renderSettings(overrides: Partial<typeof baseEvent>) {
  const event = { ...baseEvent, ...overrides };
  vi.stubGlobal("fetch", routeFetch(event));
  renderWithTheme(<EventSettingsPage eventId="evt-1" />);
  await screen.findByText(event.title);
  await waitFor(() => expect(settingsControls().publicToggle).toBeInTheDocument());
  return settingsControls();
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EventSettingsPage — settings controls follow the server's ownerless-open rule", () => {
  it("disables the settings controls on an ownerless PUBLIC event (an Open Pickup)", async () => {
    const { publicToggle, competitionToggle, durationField } = await renderSettings({
      ownerId: null,
      isPublic: true,
    });

    expect(publicToggle).toBeDisabled();
    expect(competitionToggle).toBeDisabled();
    expect(durationField).toBeDisabled();
  });

  it("keeps the settings controls editable on an ownerless UNLISTED event (the share link is the capability)", async () => {
    const { publicToggle, competitionToggle, durationField } = await renderSettings({
      ownerId: null,
      isPublic: false,
    });

    expect(publicToggle).toBeEnabled();
    expect(competitionToggle).toBeEnabled();
    expect(durationField).toBeEnabled();
  });

  it("keeps the settings controls editable for the owner of a public event", async () => {
    const { publicToggle, competitionToggle, durationField } = await renderSettings({
      ownerId: "u-1",
      isPublic: true,
    });

    expect(publicToggle).toBeEnabled();
    expect(competitionToggle).toBeEnabled();
    expect(durationField).toBeEnabled();
  });
});