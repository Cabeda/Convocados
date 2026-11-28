/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { cssFor } from "../emotionCss";
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
  gameStatus: string | null; isParticipant: boolean; onSignedIn: () => void; onCancelGame: () => void; onClaimOwnership: () => Promise<void>;
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
      isOwnerless={o.isOwnerless ?? false} hasTeams={false} gameStatus={o.gameStatus ?? null}
      isParticipant={o.isParticipant ?? true} onSignedIn={o.onSignedIn}
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

  it("a signed-out header has Share and More, no Edit, and offers to sign in to follow", () => {
    renderHeader({ isAuthenticated: false });
    expect(screen.getByRole("button", { name: "Share with players" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Follow game" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit details" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in to follow" })).toBeInTheDocument();
  });

  it("puts Follow and Edit as words in a quiet row under the info, and only Share and More beside the title", async () => {
    renderHeader({ canEditSettings: true });
    const follow = await screen.findByRole("button", { name: "Follow game" });
    const edit = screen.getByRole("button", { name: "Edit details" });
    expect(follow).toHaveTextContent("Follow game");
    expect(edit).toHaveTextContent("Edit details");
    const titleRow = screen.getByRole("heading", { level: 1 }).parentElement.parentElement;
    expect(titleRow).toContainElement(screen.getByRole("button", { name: "Share with players" }));
    expect(titleRow).toContainElement(screen.getByRole("button", { name: "More" }));
    expect(titleRow).not.toContainElement(follow);
    expect(titleRow).not.toContainElement(edit);
  });

  it("keeps a very long title whole for readers: the full text is the heading name and the tooltip", () => {
    const long = "Quinta-feira à noite no pavilhão da escola secundária com muitos amigos e convidados de outras equipas";
    renderHeader({ event: { title: long } });
    expect(screen.getByRole("heading", { level: 1, name: long })).toHaveAttribute("title", long);
  });

  it("names Share and More for pointer users with a tooltip, and More is a word on wide screens", () => {
    renderHeader();
    expect(screen.getByRole("button", { name: "Share with players" })).toHaveAttribute("aria-label", "Share with players");
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveTextContent("More");
  });

  it("gives the Edit and More triggers aria-expanded and aria-controls", async () => {
    const user = userEvent.setup();
    renderHeader({ canEditSettings: true });
    const edit = screen.getByRole("button", { name: "Edit details" });
    expect(edit).toHaveAttribute("aria-expanded", "false");
    await user.click(edit);
    expect(edit).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(edit.getAttribute("aria-controls"))).toContainElement(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    const more = screen.getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    expect(more).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(more.getAttribute("aria-controls"))).toBe(await screen.findByRole("dialog", { name: "More" }));
  });

  it("gives a signed-in viewer a Follow button that says what it does", async () => {
    renderHeader({ canEditSettings: true });
    expect(await screen.findByRole("button", { name: "Follow game" })).toBeInTheDocument();
  });

  it("copies the link when the phone has no share sheet, and says so politely", async () => {
    const writeText = vi.fn(async () => {});
    const user = userEvent.setup();
    stubNavigator({ share: undefined, clipboard: { writeText } });
    renderHeader();
    await user.click(screen.getByRole("button", { name: "Share with players" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${window.location.pathname}`));
    expect(await screen.findByRole("status")).toHaveTextContent(/copied/i);
  });

  it("shares the address without its query, so an invite token or a password bypass never travels", async () => {
    const share = vi.fn(async () => {});
    const user = userEvent.setup();
    stubNavigator({ share });
    window.history.pushState({}, "", "/events/evt-1?inviteToken=secret&action=join");
    renderHeader();
    await user.click(screen.getByRole("button", { name: "Share with players" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    const payload = share.mock.calls[0][0];
    expect(payload.url).toBe(`${window.location.origin}/events/evt-1`);
    expect(payload.text).not.toContain("secret");
    window.history.pushState({}, "", "/");
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

  it("dismissing the share sheet is not an error and does not claim a copy", async () => {
    const share = vi.fn(async () => { throw new DOMException("dismissed", "AbortError"); });
    const writeText = vi.fn(async () => {});
    const user = userEvent.setup();
    stubNavigator({ share, clipboard: { writeText } });
    renderHeader();
    await user.click(screen.getByRole("button", { name: "Share with players" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("tells a viewer whose browser refuses the clipboard how to copy the link by hand", async () => {
    const user = userEvent.setup();
    stubNavigator({ share: undefined, clipboard: { writeText: vi.fn(async () => { throw new DOMException("no", "NotAllowedError"); }) } });
    renderHeader();
    await user.click(screen.getByRole("button", { name: "Share with players" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Couldn't copy the link. Press and hold the address bar to copy it.");
  });
});

describe("EventHeader — when and where", () => {
  it("says a one-off's date, time and length once", () => {
    renderHeader();
    expect(screen.getByText(/^\w{3} \d+ \w+ · \d\d:\d\d · 90 min$/)).toBeInTheDocument();
  });

  it("says a weekly game repeats instead of giving one date", () => {
    renderHeader({ event: { isRecurring: true, recurrenceRule: JSON.stringify({ freq: "weekly", interval: 1, byDay: "FR" }) } });
    expect(screen.getByText(/^Weekly · \w{3} \d\d:\d\d · 90 min$/)).toBeInTheDocument();
  });

  it("names another time zone on its own line, with no dot left hanging", () => {
    renderHeader({ event: { timezone: "Asia/Tokyo" } });
    const tz = screen.getByTestId("tz-label");
    expect(tz).toHaveTextContent(/Tokyo|JST|Japan/);
    expect(tz.previousSibling?.textContent ?? "").not.toMatch(/·\s*$/);
  });

  it("links the place to a map", () => {
    renderHeader();
    expect(screen.getByRole("link", { name: "Campo" })).toHaveAttribute("href", expect.stringContaining("google.com/maps"));
  });

  it("shows a player their own share, and an organiser the share and the total", async () => {
    cost = { totalAmount: 50, currency: "EUR" };
    renderHeader();
    expect(await screen.findByText("€5 each")).toBeInTheDocument();
    expect(screen.queryByText(/total/)).not.toBeInTheDocument();
    cleanup();
    cost = { totalAmount: 80, currency: "EUR" };
    renderHeader({ canEditSettings: true, event: { maxPlayers: 16 } });
    expect(await screen.findByText("€5 each · €80 total")).toBeInTheDocument();
  });

  it("holds the price's room, unseen and unread, until the answer is in", async () => {
    cost = { totalAmount: 50, currency: "EUR" };
    renderHeader();
    const room = screen.getByTestId("price-room");
    expect(room).toHaveAttribute("aria-hidden", "true");
    expect(await screen.findByText("€5 each")).toBeInTheDocument();
    expect(screen.queryByTestId("price-room")).not.toBeInTheDocument();
  });

  it("does not call the cost API for someone who is neither a player nor an organiser", async () => {
    renderHeader({ isAuthenticated: true, isParticipant: false });
    await screen.findByRole("button", { name: "Follow game" });
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/cost"), expect.anything());
  });

  it("cuts a very long title at three lines at normal text size, and shows it whole at 200% text", () => {
    const title = "A very long title ".repeat(12);
    renderHeader({ event: { title } });
    expect(cssFor(screen.getByRole("heading", { level: 1 }))).toMatch(/-webkit-line-clamp:\s*3/);
    cleanup();
    const root = document.documentElement;
    root.style.fontSize = "32px";
    try {
      renderHeader({ event: { title } });
      expect(cssFor(screen.getByRole("heading", { level: 1 }))).not.toMatch(/line-clamp/);
    } finally { root.style.fontSize = ""; }
  });

  it("says just Ended once a one-off is over: the recap card keeps the day, so it is not said twice", () => {
    renderHeader({ event: { dateTime: new Date(Date.now() - 5 * 86400_000).toISOString() } });
    expect(screen.getByText("Ended")).toBeInTheDocument();
  });

  it("looks cancelled: the word Cancelled, the date struck through, no Share and no Follow", async () => {
    renderHeader({ gameStatus: "cancelled" });
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    const struck = screen.getByText(/· \d\d:\d\d · 90 min$/);
    expect(struck.tagName).toBe("S");
    expect(screen.queryByRole("button", { name: "Share with players" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Follow game|Following/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "More" })).toBeInTheDocument();
  });

  it("does not ask for the price at all when signed out", () => {
    renderHeader({ isAuthenticated: false, isParticipant: false });
    expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining("/cost"), expect.anything());
  });
});

describe("EventHeader — chips", () => {
  it("shows an Archived chip next to the title", () => {
    renderHeader({ event: { archivedAt: new Date().toISOString() } });
    expect(screen.getByText("Archived")).toBeInTheDocument();
  });

  it("lets a signed-in viewer claim an ownerless game, once per tap, and says so", async () => {
    let release;
    const onClaimOwnership = vi.fn(() => new Promise<void>((r) => { release = r; }));
    renderHeader({ isOwnerless: true, onClaimOwnership });
    const chip = screen.getByRole("button", { name: "Claim this game" });
    fireEvent.click(chip);
    fireEvent.click(chip);
    expect(onClaimOwnership).toHaveBeenCalledTimes(1);
    release();
    expect(await screen.findByRole("status")).toHaveTextContent("You now manage this game");
  });

  it("says plainly when the claim did not go through", async () => {
    const user = userEvent.setup();
    renderHeader({ isOwnerless: true, onClaimOwnership: vi.fn(async () => { throw new Error("no"); }) });
    await user.click(screen.getByRole("button", { name: "Claim this game" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't claim this game. Check your connection and try again.");
    expect(screen.queryByText("You now manage this game")).not.toBeInTheDocument();
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
    expect(within(sheet).getByRole("link", { name: "Event settings" })).toHaveAttribute("href", "/events/evt-1/settings");
    expect(within(sheet).getByRole("link", { name: "Add to calendar Apple or Outlook" })).toHaveAttribute("href", "/api/events/evt-1/calendar");
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
    for (const name of [/Cancel game/, /Ratings/, /Event settings/, /My notifications/]) {
      expect(within(sheet).queryByRole(/link|button/, { name })).not.toBeInTheDocument();
    }
  });

  it("gives an admin Cancel game, and Ratings only when the game has an owner", async () => {
    const user = userEvent.setup();
    const onCancelGame = vi.fn();
    renderHeader({ canEditSettings: true, onCancelGame });
    const sheet = await openSheet(user);
    expect(within(sheet).getByRole("link", { name: "Ratings" })).toBeInTheDocument();
    await user.click(within(sheet).getByRole("button", { name: "Cancel game" }));
    expect(onCancelGame).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument());
    cleanup();
    renderHeader({ canEditSettings: true, isOwnerless: true });
    const again = await openSheet(user);
    expect(within(again).queryByRole("link", { name: "Ratings" })).not.toBeInTheDocument();
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
    expect(within(sheet).queryByRole("link", { name: "Add to calendar Apple or Outlook" })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "Attendance" })).toBeInTheDocument();
  });

  it("has a visible Close button that closes the sheet and gives focus back to More", async () => {
    const user = userEvent.setup();
    renderHeader();
    const more = screen.getByRole("button", { name: "More" });
    const sheet = await openSheet(user);
    const close = within(sheet).getByRole("button", { name: "Close" });
    expect(close).toHaveTextContent("");
    await user.click(close);
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "More" })).not.toBeInTheDocument());
    expect(more).toHaveFocus();
  });

  it("puts Cancel game last, below Event settings, in the Manage group", async () => {
    const user = userEvent.setup();
    renderHeader({ canEditSettings: true });
    const sheet = await openSheet(user);
    const manage = within(sheet).getByRole("group", { name: "Manage" });
    const rows = [...manage.querySelectorAll("a, button")].map((r) => r.textContent);
    expect(rows).toEqual(["Manage lineup", "Event settings", "Cancel game"]);
    expect(within(sheet).queryByRole("group", { name: "This game" })?.textContent ?? "").not.toMatch(/Cancel game/);
  });

  it("writes every row in sentence case and says what the calendar file is for", async () => {
    const user = userEvent.setup();
    renderHeader({ canEditSettings: true });
    const sheet = await openSheet(user);
    for (const name of ["Event settings", "Ratings", "My notifications"]) {
      expect(within(sheet).getByText(name)).toBeInTheDocument();
    }
    // One plain name for the calendar, then who each way is for: no brackets, no brand lists in a label.
    expect(within(sheet).getAllByText("Add to calendar")).toHaveLength(2);
    expect(within(sheet).getByText("Apple or Outlook")).toBeInTheDocument();
    expect(within(sheet).getByText("Google")).toBeInTheDocument();
    expect(within(sheet).queryByText(/Event Settings|Skill Rating|Download/)).not.toBeInTheDocument();
  });

  it("leaves Payments out for a signed-out viewer of an owned game, where it would be a dead end", async () => {
    const user = userEvent.setup();
    renderHeader({ isAuthenticated: false, isParticipant: false });
    const sheet = await openSheet(user);
    expect(within(sheet).queryByRole("link", { name: "Payments" })).not.toBeInTheDocument();
    expect(within(sheet).getByRole("link", { name: "History and results" })).toBeInTheDocument();
  });

  it("keeps Payments for a signed-out viewer of a game nobody owns, which the link opens", async () => {
    const user = userEvent.setup();
    renderHeader({ isAuthenticated: false, isParticipant: false, isOwnerless: true, event: { ownerId: null, ownerName: null } });
    const sheet = await openSheet(user);
    expect(within(sheet).getByRole("link", { name: "Payments" })).toBeInTheDocument();
  });

  it("opens as a side sheet on the right on a wide screen, and from the bottom on a phone", async () => {
    const user = userEvent.setup();
    const media = (matches: boolean) => vi.stubGlobal("matchMedia", (q: string) => ({
      matches: matches && /min-width|up/.test(q) ? true : false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false,
    }));
    media(true);
    renderHeader();
    let sheet = await openSheet(user);
    expect(sheet).toHaveAttribute("data-anchor", "right");
    cleanup();
    media(false);
    renderHeader();
    sheet = await openSheet(user);
    expect(sheet).toHaveAttribute("data-anchor", "bottom");
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

  it("saves only what changed, announces Saved and closes once the server has answered", async () => {
    const user = userEvent.setup();
    let release;
    const props = renderHeader({ canEditSettings: true, onSaveTitle: vi.fn(() => new Promise<void>((r) => { release = r; })) });
    await openForm(user);
    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "Friday Football");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(props.onSaveTitle).toHaveBeenCalledWith("Friday Football");
    expect(props.onSaveLocation).not.toHaveBeenCalled();
    expect(props.onSaveDateTime).not.toHaveBeenCalled();
    // Still open while the request is out: nothing to lose yet, and a second tap cannot send a second request.
    expect(screen.getByLabelText("Name")).toHaveValue("Friday Football");
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    release();
    await waitFor(() => expect(screen.queryByLabelText("Name")).not.toBeInTheDocument());
    expect(await screen.findByRole("status")).toHaveTextContent("Saved");
  });

  it("keeps the form open with the draft, says nothing was saved and focuses the failing field", async () => {
    const user = userEvent.setup();
    const props = renderHeader({ canEditSettings: true, onSaveTitle: vi.fn(async () => { throw new Error("no"); }) });
    await openForm(user);
    const name = screen.getByLabelText("Name");
    await user.type(name, "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Not saved. Your changes are still here.");
    expect(screen.getByLabelText("Name")).toHaveValue("Monday Football!");
    expect(screen.getByLabelText("Name")).toHaveFocus();
    expect(screen.queryByText("Saved")).not.toBeInTheDocument();
    // Fixing the cause and trying again works, and the page closes the form then.
    props.onSaveTitle.mockImplementation(async () => {});
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByLabelText("Name")).not.toBeInTheDocument());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("when only some edits fail, the ones that worked are not sent a second time", async () => {
    const user = userEvent.setup();
    const props = renderHeader({ canEditSettings: true, onSaveLocation: vi.fn(async () => { throw new Error("no"); }) });
    await openForm(user);
    await user.type(screen.getByLabelText("Name"), "!");
    await user.type(screen.getByLabelText("Location"), "!");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByRole("alert");
    expect(screen.getByLabelText("Location")).toHaveFocus();
    props.onSaveLocation.mockImplementation(async () => {});
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(screen.queryByLabelText("Name")).not.toBeInTheDocument());
    expect(props.onSaveTitle).toHaveBeenCalledTimes(1);
    expect(props.onSaveLocation).toHaveBeenCalledTimes(2);
  });

  it("disables Save and says why when the name is empty", async () => {
    const user = userEvent.setup();
    const props = renderHeader({ canEditSettings: true });
    await openForm(user);
    await user.clear(screen.getByLabelText("Name"));
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Give the game a name.")).toBeInTheDocument();
    expect(screen.getByLabelText("Name")).toBeInvalid();
    expect(props.onSaveTitle).not.toHaveBeenCalled();
  });

  it("disables Save and says why when the date is cleared", async () => {
    const user = userEvent.setup();
    renderHeader({ canEditSettings: true });
    await openForm(user);
    fireEvent.change(screen.getByLabelText("Date & time"), { target: { value: "" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Pick a date and time.")).toBeInTheDocument();
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

  it("has no one-letter shortcut: typing e outside a field does nothing", async () => {
    const user = userEvent.setup();
    renderHeader({ canEditSettings: true });
    await user.keyboard("e");
    expect(screen.queryByLabelText("Name")).not.toBeInTheDocument();
  });
});
