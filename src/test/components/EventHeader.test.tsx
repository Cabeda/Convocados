/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { EventHeader } from "~/components/event/EventHeader";
import type { EventData } from "~/components/event/types";

vi.mock("~/components/event/MyNotificationsDialog", () => ({
  MyNotificationsDialog: ({ open }: { open: boolean }) => (open ? <div role="dialog" aria-label="My notifications dialog" /> : null),
}));
vi.mock("~/components/LocationAutocomplete", () => ({
  default: ({ value, onChange, label }) => <input aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} />,
  reverseGeocode: vi.fn(),
}));

const baseEvent = {
  id: "evt-1", title: "Monday Football", location: "Campo",
  dateTime: new Date(Date.now() + 3 * 86400_000).toISOString(),
  timezone: "UTC", maxPlayers: 10, durationMinutes: 90, isRecurring: false, eloEnabled: true,
  sport: "football-5v5", recurrenceRule: null, ownerId: "owner-1", ownerName: "Sam Owner", players: [],
} as EventData;

type Overrides = Partial<{
  event: Partial<EventData>; canEditSettings: boolean; isAuthenticated: boolean; isOwnerless: boolean;
  gameStatus: string | null; onCancelGame: () => void; onClaimOwnership: () => Promise<void>;
  onSaveTitle: (t: string) => Promise<void>; onSaveLocation: (l: string) => Promise<void>;
  onSaveDateTime: (d: string, tz: string) => Promise<void>; onSaveSport: (s: string) => Promise<void>;
}>;

function renderHeader(o: Overrides = {}) {
  const event = { ...baseEvent, ...o.event } as EventData;
  const props = {
    onCancelGame: vi.fn(), onClaimOwnership: vi.fn(async () => {}),
    onSaveTitle: vi.fn(async () => {}), onSaveLocation: vi.fn(async () => {}),
    onSaveDateTime: vi.fn(async () => {}), onSaveSport: vi.fn(async () => {}),
    ...o,
  };
  renderWithTheme(
    <EventHeader
      eventId="evt-1" event={event} sport={event.sport} gameDate={new Date(event.dateTime)}
      canEditSettings={o.canEditSettings ?? false} isAuthenticated={o.isAuthenticated ?? true}
      isOwnerless={o.isOwnerless ?? false} localMatches={null} gameStatus={o.gameStatus ?? null}
      onSaveTitle={props.onSaveTitle} onSaveLocation={props.onSaveLocation} onSaveDateTime={props.onSaveDateTime}
      onSaveSport={props.onSaveSport} onClaimOwnership={props.onClaimOwnership} onCancelGame={props.onCancelGame}
    />,
  );
  return props;
}

let cost: unknown = null;
beforeEach(() => {
  cost = null;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const body = String(url).endsWith("/cost") ? cost : { following: false };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  }));
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete navigator.share; delete navigator.clipboard;
});

const stubNavigator = (props: Record<string, unknown>) => {
  for (const [key, value] of Object.entries(props)) Object.defineProperty(navigator, key, { configurable: true, value });
};

const openSheet = async (user) => {
  await user.click(screen.getByRole("button", { name: "More" }));
  return screen.findByRole("dialog", { name: "More" });
};

describe("EventHeader — the line-up of actions", () => {
  it("names the game with one h1 and flat, with no card around it", () => {
    renderHeader();
    expect(screen.getByRole("heading", { level: 1, name: "Monday Football" })).toBeInTheDocument();
    expect(screen.getByRole("banner").className).not.toMatch(/MuiPaper/);
  });

  it("keeps Share for a game that is already over (it is about the next one)", () => {
    renderHeader({ event: { dateTime: new Date(Date.now() - 5 * 86400_000).toISOString() } });
    expect(screen.getByRole("button", { name: "Share with players" })).toBeInTheDocument();
  });

  it("a signed-out header has Share and More but no Follow and no Edit", () => {
    renderHeader({ isAuthenticated: false });
    expect(screen.getByRole("button", { name: "Share with players" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Follow game" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
  });

  it("gives a signed-in viewer a Follow toggle and an admin the pencil", () => {
    renderHeader({ canEditSettings: true });
    expect(screen.getByRole("button", { name: "Follow game" })).toHaveAttribute("aria-pressed");
    expect(screen.getByRole("button", { name: "Edit details" })).toBeInTheDocument();
  });

  it("copies the link when the phone has no share sheet, and says so politely", async () => {
    const writeText = vi.fn(async () => {});
    const user = userEvent.setup();
    stubNavigator({ share: undefined, clipboard: { writeText } });
    renderHeader();
    await user.click(screen.getByRole("button", { name: "Share with players" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(window.location.href));
    expect(await screen.findByRole("status")).toHaveTextContent(/copied/i);
  });

  it("uses the native share sheet when there is one and does not also copy", async () => {
    const share = vi.fn(async () => {});
    const writeText = vi.fn(async () => {});
    const user = userEvent.setup();
    stubNavigator({ share, clipboard: { writeText } });
    renderHeader();
    await user.click(screen.getByRole("button", { name: "Share with players" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(writeText).not.toHaveBeenCalled();
  });
});

describe("EventHeader — when and where", () => {
  it("says a one-off's date, time and length once", () => {
    renderHeader();
    expect(screen.getByText(/ at \d\d:\d\d · 90 min/)).toBeInTheDocument();
  });

  it("says a weekly game repeats instead of giving one date", () => {
    renderHeader({ event: { isRecurring: true, recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }) } });
    expect(screen.getByText(/Every week on Friday at \d\d:\d\d · 90 min/)).toBeInTheDocument();
  });

  it("links the place to a map", () => {
    renderHeader();
    expect(screen.getByRole("link", { name: "Campo" })).toHaveAttribute("href", expect.stringContaining("google.com/maps"));
  });

  it("shows the price per player to someone who can see it", async () => {
    cost = { totalAmount: 50, currency: "EUR" };
    renderHeader();
    expect(await screen.findByText(/€5 each/)).toBeInTheDocument();
  });

  it("offers an admin a way to set a price, and offers a player nothing", async () => {
    renderHeader({ canEditSettings: true });
    expect(await screen.findByRole("link", { name: "Set price" })).toHaveAttribute("href", "/events/evt-1/payments");
    cleanup();
    renderHeader({ canEditSettings: false });
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByRole("link", { name: "Set price" })).not.toBeInTheDocument();
  });

  it("does not ask for the price at all when signed out", () => {
    renderHeader({ isAuthenticated: false });
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/cost"), expect.anything());
  });
});

describe("EventHeader — chips", () => {
  it("shows an Archived chip next to the title", () => {
    renderHeader({ event: { archivedAt: new Date().toISOString() } });
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("lets a signed-in viewer claim an ownerless game, once per tap", async () => {
    let release;
    const onClaimOwnership = vi.fn(() => new Promise<void>((r) => { release = r; }));
    renderHeader({ isOwnerless: true, onClaimOwnership });
    const chip = screen.getByRole("button", { name: "Claim this game" });
    fireEvent.click(chip);
    fireEvent.click(chip);
    expect(onClaimOwnership).toHaveBeenCalledTimes(1);
    release();
  });

  it("does not offer the claim to a signed-out viewer or on an owned game", () => {
    renderHeader({ isOwnerless: true, isAuthenticated: false });
    expect(screen.queryByRole("button", { name: "Claim this game" })).not.toBeInTheDocument();
    cleanup();
    renderHeader({ isOwnerless: false });
    expect(screen.queryByRole("button", { name: "Claim this game" })).not.toBeInTheDocument();
  });
});

describe("EventHeader — the More sheet", () => {
  it("moves focus into the sheet, closes on Esc and puts focus back on the button", async () => {
    const user = userEvent.setup();
    renderHeader();
    const more = screen.getByRole("button", { name: "More" });
    await user.click(more);
    const sheet = await screen.findByRole("dialog", { name: "More" });
    expect(sheet).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument());
    expect(more).toHaveFocus();
  });

  it("closes when a row is chosen", async () => {
    const user = userEvent.setup();
    renderHeader();
    const sheet = await openSheet(user);
    await user.click(within(sheet).getByRole("link", { name: "History and results" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument());
  });

  it("groups the rows and links each to its page", async () => {
    const user = userEvent.setup();
    renderHeader({ canEditSettings: true });
    const sheet = await openSheet(user);
    for (const g of ["This game", "Look back", "You", "Manage"]) expect(within(sheet).getByRole("group", { name: g })).toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "History and results" })).toHaveAttribute("href", "/events/evt-1/history");
    expect(within(sheet).getByRole("link", { name: "Payments" })).toHaveAttribute("href", "/events/evt-1/payments");
    expect(within(sheet).getByRole("link", { name: "Event Settings" })).toHaveAttribute("href", "/events/evt-1/settings");
    expect(within(sheet).getByRole("link", { name: "Download .ics" })).toHaveAttribute("href", "/api/events/evt-1/calendar");
  });

  it("says who manages the game, linking to their profile, at the top", async () => {
    const user = userEvent.setup();
    renderHeader();
    const sheet = await openSheet(user);
    const link = within(sheet).getByRole("link", { name: /Managed by Sam Owner/ });
    expect(link).toHaveAttribute("href", "/users/owner-1");
  });

  it("gives a plain player no admin rows, and a signed-out viewer no personal row", async () => {
    const user = userEvent.setup();
    renderHeader({ canEditSettings: false, isAuthenticated: false });
    const sheet = await openSheet(user);
    for (const name of [/Cancel game/, /Skill Rating/, /Event Settings/, /My notifications/]) {
      expect(within(sheet).queryByRole(/link|button/, { name })).not.toBeInTheDocument();
    }
  });

  it("gives an admin Cancel game, and Ratings only when the game has an owner", async () => {
    const user = userEvent.setup();
    const onCancelGame = vi.fn();
    renderHeader({ canEditSettings: true, onCancelGame });
    const sheet = await openSheet(user);
    expect(within(sheet).getByRole("link", { name: "Skill Rating" })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Cancel game" }));
    expect(onCancelGame).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument());
    cleanup();
    renderHeader({ canEditSettings: true, isOwnerless: true });
    const again = await openSheet(user);
    expect(within(again).queryByRole("link", { name: "Skill Rating" })).not.toBeInTheDocument();
  });

  it("opens My notifications for a signed-in viewer", async () => {
    const user = userEvent.setup();
    renderHeader();
    const sheet = await openSheet(user);
    await user.click(within(sheet).getByRole("button", { name: "My notifications" }));
    expect(await screen.findByRole("dialog", { name: "My notifications dialog" })).toBeInTheDocument();
  });

  it("keeps the calendar rows for a game still to come and drops them once it is over", async () => {
    const user = userEvent.setup();
    renderHeader({ event: { dateTime: new Date(Date.now() - 5 * 86400_000).toISOString() } });
    const sheet = await openSheet(user);
    expect(within(sheet).queryByRole("link", { name: "Download .ics" })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Attendance" })).toBeInTheDocument();
  });

  it("does not offer to cancel a game that is already cancelled", async () => {
    const user = userEvent.setup();
    renderHeader({ canEditSettings: true, gameStatus: "cancelled" });
    const sheet = await openSheet(user);
    expect(within(sheet).queryByRole("button", { name: "Cancel game" })).not.toBeInTheDocument();
  });
});

describe("EventHeader — editing", () => {
  const openForm = async (user) => { await user.click(screen.getByRole("button", { name: "Edit details" })); };

  it("opens Name, When and Where with sport and time zone behind More details", async () => {
    const user = userEvent.setup();
    renderHeader({ canEditSettings: true });
    await openForm(user);
    expect(screen.getByLabelText("Name")).toHaveValue("Monday Football");
    expect(screen.getByLabelText("Date & time")).toBeInTheDocument();
    expect(screen.getByLabelText("Location")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sport")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "More details" }));
    expect(screen.getByRole("combobox", { name: "Sport" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Timezone" })).toBeInTheDocument();
  });

  it("saves only what changed, closes straight away and announces Saved", async () => {
    const user = userEvent.setup();
    const props = renderHeader({ canEditSettings: true });
    await openForm(user);
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Friday Football");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSaveTitle).toHaveBeenCalledWith("Friday Football");
    expect(props.onSaveLocation).not.toHaveBeenCalled();
    expect(props.onSaveDateTime).not.toHaveBeenCalled();
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  it("says plainly when the server refused, and does not claim it saved", async () => {
    const user = userEvent.setup();
    renderHeader({ canEditSettings: true, onSaveTitle: vi.fn(async () => { throw new Error("no"); }) });
    await openForm(user);
    await user.type(screen.getByLabelText("Name"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("status")).toHaveTextContent(/couldn't save/i);
  });

  it("Cancel and Esc close the form without saving and put focus back on the pencil", async () => {
    const user = userEvent.setup();
    const props = renderHeader({ canEditSettings: true });
    const pencil = screen.getByRole("button", { name: "Edit details" });
    await user.click(pencil);
    await user.type(screen.getByLabelText("Name"), "x");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(pencil).toHaveFocus();
    await user.click(pencil);
    await user.keyboard("{Escape}");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
    expect(props.onSaveTitle).not.toHaveBeenCalled();
  });

  it("opens with the e shortcut for an admin and ignores it while typing", async () => {
    const user = userEvent.setup();
    renderHeader({ canEditSettings: true });
    await user.keyboard("e");
    const name = await screen.findByLabelText("Name");
    await user.type(name, "e");
    expect(name).toHaveValue("Monday Footballe");
  });
});
