// GH-1782 — the per-event reminder gates (Event.reminder24h/2h/1h) had a
// writer API but no screen, so an organizer could never turn 1h on or mute the
// 24h/2h reminders the crew does not need. Event Settings must read the gates
// from GET reminder-timings, PUT only the field the organizer toggled, and keep
// the value after a reload.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";

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
  ownerId: "u-1",
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

type Timings = { reminder24h: boolean; reminder2h: boolean; reminder1h: boolean };

function routeFetch(event: Record<string, unknown>, timings: Timings, puts: unknown[] = []) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (href.endsWith("/reminder-timings")) {
      if ((init?.method ?? "GET") === "PUT") {
        const patch = JSON.parse(String(init?.body)) as Partial<Timings>;
        Object.assign(timings, patch);
        puts.push(patch);
        return Response.json({ ...timings });
      }
      return Response.json({ ...timings });
    }
    if (href.endsWith("/api/events/evt-1")) return Response.json(event);
    if (href.includes("/priority")) {
      return Response.json({ settings: null, enrollments: [], eligible: [], ineligible: [], maxSlots: 0 });
    }
    if (href.includes("/access/invites")) return Response.json([]);
    if (href.includes("/admins")) return Response.json([]);
    if (href.includes("/access")) return Response.json({ hasPassword: false });
    return Response.json([]);
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("EventSettingsPage — per-event reminder switches (GH-1782)", () => {
  it("renders the three reminder switches from GET reminder-timings", async () => {
    const timings: Timings = { reminder24h: true, reminder2h: true, reminder1h: false };
    vi.stubGlobal("fetch", routeFetch(baseEvent, timings));

    renderWithTheme(<EventSettingsPage eventId="evt-1" />);

    await screen.findByText(baseEvent.title);
    const oneHour = await screen.findByRole("switch", { name: /1 hour before/i });
    expect(oneHour).not.toBeChecked();
    expect(screen.getByRole("switch", { name: /24 hours before/i })).toBeChecked();
    expect(screen.getByRole("switch", { name: /2 hours before/i })).toBeChecked();
  });

  it("PUTs only the toggled field and keeps it after a reload", async () => {
    const timings: Timings = { reminder24h: true, reminder2h: true, reminder1h: false };
    const puts: unknown[] = [];
    vi.stubGlobal("fetch", routeFetch(baseEvent, timings, puts));

    const first = renderWithTheme(<EventSettingsPage eventId="evt-1" />);
    const oneHour = await screen.findByRole("switch", { name: /1 hour before/i });
    fireEvent.click(oneHour);

    await waitFor(() => expect(puts).toEqual([{ reminder1h: true }]));
    expect(oneHour).toBeChecked();

    first.unmount();
    vi.stubGlobal("fetch", routeFetch(baseEvent, timings, puts));
    renderWithTheme(<EventSettingsPage eventId="evt-1" />);

    const reloaded = await screen.findByRole("switch", { name: /1 hour before/i });
    await waitFor(() => expect(reloaded).toBeChecked());
  });

  it("explains when every reminder is off for the event", async () => {
    const timings: Timings = { reminder24h: false, reminder2h: false, reminder1h: false };
    vi.stubGlobal("fetch", routeFetch(baseEvent, timings));

    renderWithTheme(<EventSettingsPage eventId="evt-1" />);

    await screen.findByText(baseEvent.title);
    expect(await screen.findByText(/all reminders are off/i)).toBeInTheDocument();
  });
});
