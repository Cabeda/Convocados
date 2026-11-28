import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import EventPage from "~/components/EventPage";
import { formatDateInTz } from "~/lib/timezones";
import { HOUR, WEEKLY, fakeServer, makeEvent, respond, type Row } from "./eventPageHarness";

// Stable session identity — a fresh object per render re-triggers load effects.
const mockSession = { data: { user: { id: "u-1", name: "Jose Silva" } } as { user: { id: string; name: string } } | null, isPending: false, refetch: vi.fn() };
vi.mock("~/lib/auth.client", () => ({ useSession: () => mockSession, signOut: vi.fn() }));

const rows = (n: number, from = 0): Row[] => Array.from({ length: n }, (_, i) => ({ id: `p${from + i}`, name: `Player ${from + i}`, userId: null }));
const me: Row = { id: "me", name: "Jose Silva", userId: "u-1" };

let server: ReturnType<typeof fakeServer>;
function renderPage(over: Record<string, unknown> = {}, setup?: (s: ReturnType<typeof fakeServer>) => void) {
  server = fakeServer(makeEvent(over));
  setup?.(server);
  server.install();
  return renderWithTheme(<EventPage eventId="evt-1" />);
}
/** The server adds the caller as a linked row, like POST /players does. */
function serverJoins(row: Row = me) {
  server.on("POST", "/players", () => { server.state.event.players.push(row); return { ok: true, resolvedName: row.name, anonymous: false }; });
}

beforeEach(() => {
  localStorage.clear();
  mockSession.data = { user: { id: "u-1", name: "Jose Silva" } };
  window.history.pushState({}, "", "/events/evt-1");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Next game — what the block says", () => {
  it("names the next game, gives its date and time, and counts who is in", async () => {
    renderPage({ players: rows(3) });
    expect(await screen.findByRole("heading", { level: 2, name: "Next game" })).toBeInTheDocument();
    expect(screen.getByTestId("next-game-date")).toHaveTextContent(/·\s*\d{2}:\d{2}$/);
    expect(screen.getByTestId("lineup-summary")).toHaveTextContent("3 of 10 are in · 7 spots left. Teams are drawn automatically when it's full.");
  });

  it("says '1 spot left' in the singular and 'It's full' when full", async () => {
    renderPage({ players: rows(9) });
    expect(await screen.findByTestId("lineup-summary")).toHaveTextContent("9 of 10 are in · 1 spot left.");
    cleanup();
    renderPage({ players: rows(10) });
    expect(await screen.findByTestId("lineup-summary")).toHaveTextContent("10 of 10 are in · It's full.");
  });

  it("draws one slot per place, the viewer's own marked, each with the full name as its accessible name", async () => {
    renderPage({ players: [...rows(2), me, { id: "lk", name: "Linked Lia", userId: "u-lia" }] });
    await screen.findByTestId("lineup-slots");
    expect(screen.getAllByTestId("slot")).toHaveLength(3);
    expect(screen.getAllByTestId("open-slot")).toHaveLength(6);
    // A slot the viewer may open is a button named for what it does; one they may not touch is a picture with the name.
    expect(screen.getByTestId("slot-me")).toHaveAccessibleName("Options for Jose Silva (you)");
    expect(screen.getByTestId("slot-me")).toHaveAttribute("title", "Jose Silva");
    for (const open of screen.getAllByTestId("open-slot")) expect(open).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByRole("img", { name: "Linked Lia" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Options for Player 1" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "4 of 10 places taken" })).toBeInTheDocument();
  });

  it("lists the names behind the initials in 'Who's in', linking account players to their profile", async () => {
    const user = userEvent.setup();
    renderPage({ players: [{ id: "a", name: "Ana Maria", userId: "u-a" }, { id: "b", name: "Beto", userId: null }], positionsEnabled: false });
    await user.click(await screen.findByRole("button", { name: "Who's in" }));
    expect(screen.getByRole("link", { name: "Ana Maria" })).toHaveAttribute("href", "/users/u-a");
    expect(screen.getByText("Beto")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Who's in" })).toHaveAttribute("aria-expanded", "true");
  });

  it("shows a position chip in 'Who's in' only when the event uses positions", async () => {
    const user = userEvent.setup();
    renderPage({ players: [{ id: "a", name: "Ana", userId: null, position: "GK" }], positionsEnabled: true });
    await user.click(await screen.findByRole("button", { name: "Who's in" }));
    expect(screen.getByText("Goalkeeper")).toBeInTheDocument();
    cleanup();
    renderPage({ players: [{ id: "a", name: "Ana", userId: null, position: "GK" }], positionsEnabled: false });
    await user.click(await screen.findByRole("button", { name: "Who's in" }));
    expect(screen.queryByText("Goalkeeper")).not.toBeInTheDocument();
  });

  const BENCH = { maxPlayers: 2, players: [{ id: "a", name: "Ana Maria", userId: null }, { id: "b", name: "Bia", userId: null }, { id: "c", name: "Carlos Dias", userId: null }, { id: "d", name: "Duda Lima", userId: null }] };
  const closeWhosIn = async (user: ReturnType<typeof userEvent.setup>) => user.click(await screen.findByRole("button", { name: "Who's in", expanded: true }));

  it("says the bench once: numbered in 'Who's in' while it is open, in one plain line once it is closed", async () => {
    const user = userEvent.setup();
    renderPage(BENCH);
    // A bench is a reason to see the names: the list starts open, and the bench is in it, numbered.
    expect(await screen.findByText("1. Carlos Dias")).toBeInTheDocument();
    expect(screen.getByText("2. Duda Lima")).toBeInTheDocument();
    expect(screen.queryByTestId("bench-line")).not.toBeInTheDocument();
    await closeWhosIn(user);
    expect(await screen.findByTestId("bench-line")).toHaveTextContent(/^Next up: Carlos D. and Duda L.$/);
    expect(screen.queryByText("1. Carlos Dias")).not.toBeInTheDocument();
  });

  it("names the first three on the bench and counts the rest: 'and 1 more', 'and 2 more'", async () => {
    const user = userEvent.setup();
    const bench = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `b${i}`, name: ["Kátia Lima", "Luís Faria", "Marta Santos", "Nuno Reis", "Olga Pinto"][i], userId: null }));
    renderPage({ maxPlayers: 2, players: [...rows(2), ...bench(4)] });
    await closeWhosIn(user);
    expect(await screen.findByTestId("bench-line")).toHaveTextContent(/^Next up: Kátia L., Luís F., Marta S. and 1 more$/);
    cleanup();
    localStorage.clear();
    renderPage({ maxPlayers: 2, players: [...rows(2), ...bench(5)] });
    await closeWhosIn(user);
    expect(await screen.findByTestId("bench-line")).toHaveTextContent(/^Next up: Kátia L., Luís F., Marta S. and 2 more$/);
  });

  it("uses the singular verb for a bench of one", async () => {
    const user = userEvent.setup();
    renderPage({ maxPlayers: 1, players: [{ id: "a", name: "Ana", userId: null }, { id: "c", name: "Carlos", userId: null }] });
    await closeWhosIn(user);
    expect(await screen.findByTestId("bench-line")).toHaveTextContent(/^Next up: Carlos$/);
  });
});

describe("Next game — the time", () => {
  it("counts down inside the last day, in hours and minutes, under 'Game day · Today'", async () => {
    renderPage({ dateTime: new Date(Date.now() + 3 * HOUR + 12 * 60_000 - 5_000).toISOString() });
    expect(await screen.findByRole("heading", { level: 2, name: "Game day" })).toBeInTheDocument();
    expect(screen.getByTestId("next-game-date")).toHaveTextContent(/^Today · \d{2}:\d{2}$/);
    expect(screen.getByTestId("next-game-sub")).toHaveTextContent("Starts in 3 h 12 min");
  });

  it("shows no countdown more than a day away", async () => {
    renderPage();
    await screen.findByTestId("next-game-date");
    expect(screen.queryByTestId("next-game-sub")).not.toBeInTheDocument();
  });

  it("while the game is on, shows a 'Live now' pill instead of a countdown and the roster stays open", async () => {
    renderPage({ dateTime: new Date(Date.now() - 30 * 60_000).toISOString() });
    expect(await screen.findByTestId("live-pill")).toHaveTextContent("Live now");
    expect(screen.queryByTestId("next-game-sub")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I'm in" })).toBeInTheDocument();
  });

  it("after a weekly game ends it does not show the finished roster as the next game", async () => {
    renderPage({ isRecurring: true, recurrenceRule: WEEKLY, dateTime: new Date(Date.now() - 3 * HOUR).toISOString(), players: rows(5) });
    expect(await screen.findByText("Sign-ups open in a moment")).toBeInTheDocument();
    expect(screen.queryByTestId("lineup-slots")).not.toBeInTheDocument();
    expect(screen.queryByTestId("rsvp-row")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I'm in" })).not.toBeInTheDocument();
    // …and the date it names is a future one, not the day that just ended.
    const finishedDay = formatDateInTz(new Date(Date.now() - 3 * HOUR), "en", "UTC", { weekday: "short", day: "numeric", month: "short" });
    expect(finishedDay).toMatch(/\d/);
    expect(screen.getByTestId("next-game-date").textContent).not.toContain(finishedDay);
    expect(screen.getByTestId("next-game-date")).toHaveTextContent(/\d{2}:\d{2}$/);
  });

  it("after a one-off game ends there is no next game, so the block renders nothing", async () => {
    renderPage({ dateTime: new Date(Date.now() - 3 * HOUR).toISOString(), players: rows(5) });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByTestId("next-game")).not.toBeInTheDocument();
  });

  it("a cancelled game offers no RSVP and no lineup", async () => {
    renderPage({ gameStatus: "cancelled", players: rows(3) });
    await screen.findByRole("heading", { level: 2, name: "This game was cancelled" });
    expect(screen.queryByTestId("next-game")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I'm in" })).not.toBeInTheDocument();
  });
});

describe("Next game — the RSVP row", () => {
  it("asks a signed-out visitor to sign in", async () => {
    mockSession.data = null;
    renderPage();
    expect(await screen.findByRole("button", { name: "Sign in to join" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I'm in" })).not.toBeInTheDocument();
  });

  it("offers 'I'm in' and 'Can't make it' to a signed-in viewer who is not on the list", async () => {
    renderPage({ players: rows(3) });
    expect(await screen.findByRole("button", { name: "I'm in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Can't make it" })).toBeInTheDocument();
  });

  it("offers the bench when the list is full", async () => {
    renderPage({ maxPlayers: 3, players: rows(3) });
    expect(await screen.findByRole("button", { name: "Join the bench" })).toBeInTheDocument();
  });

  it("says once, in one plain sentence, what the bench means when the game is full — and not when it is not", async () => {
    renderPage({ maxPlayers: 3, players: rows(3) });
    await screen.findByRole("button", { name: "Join the bench" });
    expect(screen.getAllByText("The game is full. You'll be on the bench and move up if someone drops out.")).toHaveLength(1);
    cleanup();
    renderPage({ maxPlayers: 5, players: rows(3) });
    await screen.findByRole("button", { name: "I'm in" });
    expect(screen.queryByText(/You'll be on the bench/)).not.toBeInTheDocument();
  });

  it("joins: the slot fills at once, and the request carries the name, an idempotency key and the client id", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(2) });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    server.on("POST", "/players", async () => { await gate; server.state.event.players.push(me); return { ok: true, resolvedName: "Jose Silva", anonymous: false }; });
    await user.click(await screen.findByRole("button", { name: "I'm in" }));
    // Optimistic: believed before the server answers.
    expect(await screen.findByText("You're in")).toBeInTheDocument();
    expect(screen.getByTestId("slot-me")).toBeInTheDocument();
    release();
    await waitFor(() => expect(server.sent("POST", "/players")).toHaveLength(1));
    const call = server.sent("POST", "/players")[0];
    expect(call.body).toEqual({ name: "Jose Silva", linkToAccount: true });
    expect(call.headers["Idempotency-Key"]).toEqual(expect.any(String));
    expect(call.headers["X-Client-Id"]).toEqual(expect.any(String));
    await waitFor(() => expect(screen.getByTestId("lineup-summary")).toHaveTextContent("3 of 10 are in"));
    expect(screen.getByText("You're in")).toBeInTheDocument();
  });

  it("a second tap while the first request is running sends nothing more", async () => {
    const user = userEvent.setup();
    renderPage();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    serverJoins();
    server.on("POST", "/players", async () => { await gate; server.state.event.players.push(me); return { ok: true, resolvedName: "Jose Silva" }; });
    const button = await screen.findByRole("button", { name: "I'm in" });
    await user.dblClick(button);
    release();
    await waitFor(() => expect(screen.getByText("You're in")).toBeInTheDocument());
    expect(server.sent("POST", "/players")).toHaveLength(1);
  });

  it("puts the row back and says what happened in plain words when the server refuses", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(2) });
    server.on("POST", "/players", () => respond(500, { error: "boom" }));
    await user.click(await screen.findByRole("button", { name: "I'm in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't add you to the game. Check your connection and try again.");
    expect(screen.queryByText("boom")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slot-me")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("slot")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "I'm in" })).toBeEnabled();
  });

  it("tells a viewer the bench is full in plain words, not the server's sentence", async () => {
    const user = userEvent.setup();
    renderPage({ maxPlayers: 2, players: rows(4) });
    server.on("POST", "/players", () => respond(400, { error: "The bench is full (maximum 2 bench players)." }));
    await user.click(await screen.findByRole("button", { name: "Join the bench" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("The bench is full (maximum 2 bench players).");
  });

  it("opens the payment dialog, not an error, when the server answers 402 PAYMENT_GATE", async () => {
    const user = userEvent.setup();
    renderPage();
    server.on("POST", "/players", () => respond(402, { error: "You must settle your outstanding balance before joining.", code: "PAYMENT_GATE" }));
    await user.click(await screen.findByRole("button", { name: "I'm in" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.queryByTestId("slot-me")).not.toBeInTheDocument();
  });

  it("opens the payment dialog before sending anything when the viewer's balance says so", async () => {
    const user = userEvent.setup();
    renderPage();
    server.on("GET", "/balance", () => ({ enforcement: "hard_gate", threshold: 0, gateAmount: 5, callerBalance: { amount: 5 } }));
    await user.click(await screen.findByRole("button", { name: "I'm in" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(server.sent("POST", "/players")).toHaveLength(0);
  });

  it("says 'You're in' with the team once teams are drawn: a chosen name as it is, a stock one as 'Team 1' / 'Team 2'", async () => {
    renderPage({ players: [me, ...rows(1)], teamResults: [{ id: "t1", name: "Gunas", members: [{ name: "Jose Silva", order: 0 }] }, { id: "t2", name: "Ninjas", members: [{ name: "Player 0", order: 0 }] }] });
    expect(await screen.findByTestId("rsvp-status")).toHaveTextContent("You're in · Gunas");
    cleanup();
    renderPage({ players: [me, ...rows(1)], teamResults: [{ id: "t1", name: "Ninjas", members: [{ name: "Player 0", order: 0 }] }, { id: "t2", name: "Gunas", members: [{ name: "Jose Silva", order: 0 }] }] });
    expect(await screen.findByTestId("rsvp-status")).toHaveTextContent("You're in · Team 2");
  });

  it("says where on the bench the viewer is", async () => {
    renderPage({ maxPlayers: 2, players: [...rows(2), me] });
    expect(await screen.findByTestId("rsvp-status")).toHaveTextContent("You're on the bench (#1)");
  });

  it("does not treat an unlinked row that merely shares the viewer's name as the viewer", async () => {
    renderPage({ players: [{ id: "p-1", name: "José Silva", userId: null }] });
    expect(await screen.findByRole("button", { name: "I'm in" })).toBeInTheDocument();
    expect(screen.queryByTestId("slot-me")).not.toBeInTheDocument();
  });

  it("does not treat a linked row owned by another account as the viewer", async () => {
    renderPage({ players: [{ id: "p-1", name: "Jose Silva", userId: "u-someone-else" }] });
    expect(await screen.findByRole("button", { name: "I'm in" })).toBeInTheDocument();
  });

  it("starts as 'You're out' when the viewer already said they can't make it", async () => {
    renderPage({}, (s) => s.on("GET", "/rsvp", () => ({ status: "no" })));
    expect(await screen.findByTestId("rsvp-status")).toHaveTextContent("You're out");
  });
});

describe("Next game — changing your answer", () => {
  it("'Can't make it' from the choose row records the answer without touching the list, then 'Change' brings 'I'm in' back", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(2) });
    await user.click(await screen.findByRole("button", { name: "Can't make it" }));
    expect(await screen.findByText("You're out")).toBeInTheDocument();
    const call = server.sent("POST", "/rsvp")[0];
    expect(call.body).toEqual({ status: "no" });
    expect(server.sent("POST", "/leave")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Change" }));
    serverJoins();
    await user.click(screen.getByRole("button", { name: "I'm in" }));
    expect(await screen.findByText("You're in")).toBeInTheDocument();
  });

  it("rolls the answer back when it cannot be saved", async () => {
    const user = userEvent.setup();
    renderPage();
    server.on("POST", "/rsvp", () => respond(500, { error: "x" }));
    await user.click(await screen.findByRole("button", { name: "Can't make it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your answer. Check your connection and try again.");
    expect(screen.getByRole("button", { name: "I'm in" })).toBeInTheDocument();
  });

  it("leaving asks first, then goes through /leave, and focus lands on the row so a keyboard user is not lost", async () => {
    const user = userEvent.setup();
    renderPage({ players: [me, ...rows(3)] });
    server.on("POST", "/leave", () => { server.state.event.players = server.state.event.players.filter((p: Row) => p.id !== "me"); return { ok: true }; });
    await user.click(await screen.findByRole("button", { name: "Change" }));
    // Focus moves into the panel.
    const cant = screen.getByRole("button", { name: "Can't make it" });
    expect(cant).toHaveFocus();
    await user.click(cant);
    expect(await screen.findByText("Leave this game?")).toBeInTheDocument();
    expect(server.sent("POST", "/leave")).toHaveLength(0);
    await user.click(screen.getByTestId("leave-dialog-confirm"));
    expect(await screen.findByText("You're out")).toBeInTheDocument();
    expect(server.sent("POST", "/leave")).toHaveLength(1);
    await waitFor(() => expect(screen.getByTestId("rsvp-row")).toHaveFocus());
  });

  it("'Keep my spot' closes the panel and puts focus back on 'Change'", async () => {
    const user = userEvent.setup();
    renderPage({ players: [me] });
    await user.click(await screen.findByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("button", { name: "Keep my spot" }));
    expect(screen.queryByRole("button", { name: "Keep my spot" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change" })).toHaveFocus();
    expect(server.sent("POST", "/leave")).toHaveLength(0);
  });

  it("puts the player back in their place when leaving fails", async () => {
    const user = userEvent.setup();
    renderPage({ players: [...rows(2), me, ...rows(1, 5)] });
    server.on("POST", "/leave", () => respond(500, { error: "x" }));
    await user.click(await screen.findByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("button", { name: "Can't make it" }));
    await user.click(await screen.findByTestId("leave-dialog-confirm"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your answer");
    expect(screen.getByTestId("rsvp-status")).toHaveTextContent("You're in");
    expect(screen.getAllByTestId("slot")).toHaveLength(3);
    expect(screen.getAllByTestId("slot").map((n) => n.getAttribute("aria-label"))).toEqual(expect.arrayContaining(["Options for Player 0", "Options for Player 1", "Options for Player 5"]));
  });

  it("warns about no replacement when it is within 48 hours and nobody is on the bench", async () => {
    const user = userEvent.setup();
    renderPage({ dateTime: new Date(Date.now() + 20 * HOUR).toISOString(), players: [me, ...rows(3)] });
    await user.click(await screen.findByRole("button", { name: "Change" }));
    await user.click(screen.getByRole("button", { name: "Can't make it" }));
    expect(await screen.findByTestId("leave-dialog-no-replacement")).toBeInTheDocument();
  });
});

describe("Next game — deep links", () => {
  it("?action=join joins once the page is ready, and only once", async () => {
    window.history.pushState({}, "", "/events/evt-1?action=join");
    renderPage();
    serverJoins();
    await waitFor(() => expect(server.sent("POST", "/players")).toHaveLength(1), { timeout: 3000 });
    expect(await screen.findByText("You're in")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 700));
    expect(server.sent("POST", "/players")).toHaveLength(1);
  });

  it("?action=join does nothing on a game that is full of others' rows only because the viewer is already in", async () => {
    window.history.pushState({}, "", "/events/evt-1?action=join");
    renderPage({ players: [me] });
    await screen.findByText("You're in");
    await new Promise((r) => setTimeout(r, 700));
    expect(server.sent("POST", "/players")).toHaveLength(0);
  });

  it("?action=pay opens the payment dialog for the next game", async () => {
    window.history.pushState({}, "", "/events/evt-1?action=pay");
    renderPage();
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
  });

  it("?action=rsvp scrolls to the RSVP row", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    window.history.pushState({}, "", "/events/evt-1?action=rsvp");
    renderPage();
    await screen.findByTestId("rsvp-row");
    await waitFor(() => expect(scroll).toHaveBeenCalled());
  });
});

describe("Next game — who we are still waiting for", () => {
  const invited = [
    { id: "i1", inviteId: "inv-1", name: "Joe T", userId: "u-j", image: null, channels: { email: true, webPush: false, appPush: false }, notifiedAt: new Date(Date.now() - 30 * HOUR).toISOString() },
    { id: "i2", inviteId: "inv-2", name: "Mia R", userId: null, image: null, channels: { email: false, webPush: false, appPush: false }, notifiedAt: new Date(Date.now() - 2 * HOUR).toISOString() },
  ];
  const declined = [{ id: "d1", name: "Leo K", userId: null, image: null }];

  it("is one collapsed line: '2 invited · 1 can't make it'", async () => {
    renderPage({ invited, declined });
    const toggle = await screen.findByRole("button", { name: "2 invited · 1 can't make it" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByText("Joe T")).not.toBeInTheDocument();
  });

  it("is absent when nobody is waited for", async () => {
    renderPage();
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByRole("button", { name: /invited|can't make it/ })).not.toBeInTheDocument();
  });

  it("opens to show how each invite went out, with resend for an organizer once the 24 hour wait is over", async () => {
    const user = userEvent.setup();
    mockSession.data = { user: { id: "owner-9", name: "Sam" } };
    renderPage({ invited, declined });
    await user.click(await screen.findByRole("button", { name: /invited/ }));
    expect(screen.getByTestId("invite-channel-email-inv-1")).toHaveTextContent("email");
    expect(screen.getByTestId("invite-how-inv-2")).toHaveTextContent("Invited by link");
    expect(screen.getByTestId("resend-invite-inv-1")).toBeEnabled();
    // Mia was invited two hours ago: the wait is shown, not hidden behind a dead button.
    expect(screen.getByTestId("resend-invite-inv-2")).toBeDisabled();
    expect(screen.getByTestId("resend-invite-inv-2")).toHaveTextContent(/Resend in 2[12]h/);
    expect(screen.getByText("Leo K")).toBeInTheDocument();
  });

  it("resends with the invite id", async () => {
    const user = userEvent.setup();
    mockSession.data = { user: { id: "owner-9", name: "Sam" } };
    renderPage({ invited, declined: [] });
    server.on("PATCH", "/invites", () => ({ ok: true, channels: { email: true } }));
    await user.click(await screen.findByRole("button", { name: /invited/ }));
    await user.click(screen.getByTestId("resend-invite-inv-1"));
    await waitFor(() => expect(server.sent("PATCH", "/invites")).toHaveLength(1));
    expect(server.sent("PATCH", "/invites")[0].body).toEqual({ inviteId: "inv-1" });
  });

  it("lets only an organizer resend or cancel", async () => {
    const user = userEvent.setup();
    renderPage({ invited, declined: [] });
    await user.click(await screen.findByRole("button", { name: /invited/ }));
    expect(screen.queryByTestId("resend-invite-inv-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("retract-invite-inv-1")).not.toBeInTheDocument();
  });

  it("cancels an invite after asking, with the invite id", async () => {
    const user = userEvent.setup();
    mockSession.data = { user: { id: "owner-9", name: "Sam" } };
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderPage({ invited, declined: [] });
    await user.click(await screen.findByRole("button", { name: /invited/ }));
    await user.click(screen.getByTestId("retract-invite-inv-1"));
    await waitFor(() => expect(server.sent("DELETE", "/invites")).toHaveLength(1));
    expect(server.sent("DELETE", "/invites")[0].body).toEqual({ inviteId: "inv-1" });
  });

  it("does not cancel when the organizer says no", async () => {
    const user = userEvent.setup();
    mockSession.data = { user: { id: "owner-9", name: "Sam" } };
    vi.spyOn(window, "confirm").mockReturnValue(false);
    renderPage({ invited, declined: [] });
    await user.click(await screen.findByRole("button", { name: /invited/ }));
    await user.click(screen.getByTestId("retract-invite-inv-1"));
    expect(server.sent("DELETE", "/invites")).toHaveLength(0);
  });
});

describe("Next game — the page around it", () => {
  it("keeps a polled list from undoing what the viewer just did", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(1) });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    server.on("POST", "/players", async () => { await gate; server.state.event.players.push(me); return { ok: true, resolvedName: "Jose Silva" }; });
    await user.click(await screen.findByRole("button", { name: "I'm in" }));
    expect(await screen.findByText("You're in")).toBeInTheDocument();
    // A focus refetch lands while the write is still running, with the OLD list.
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByText("You're in")).toBeInTheDocument();
    expect(screen.getByTestId("slot-me")).toBeInTheDocument();
    release();
    await waitFor(() => expect(within(screen.getByTestId("lineup-slots")).getAllByTestId(/^slot/)).toHaveLength(2));
  });
});

describe("Next game — telling people apart in the lineup", () => {
  it("opens 'Who's in' by itself when two slots would show the same letters, and says the letters apart", async () => {
    renderPage({ players: [{ id: "a", name: "Joana Weiss", userId: null }, { id: "b", name: "Jack Weiss", userId: null }, { id: "c", name: "Rui Costa", userId: null }] });
    const list = await screen.findByTestId("whos-in");
    expect(within(list).getByText("Joana Weiss")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Who's in" })).toHaveAttribute("aria-expanded", "true");
    const letters = screen.getAllByTestId("slot").map((s) => s.textContent);
    expect(letters).toEqual(["JoW", "JaW", "RC"]);
  });

  it("starts closed when every slot is clear on its own, for someone who runs nothing", async () => {
    renderPage({ players: [{ id: "a", name: "Ana Maria", userId: null }, { id: "b", name: "Beto Santos", userId: null }] });
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByTestId("whos-in")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Who's in" })).toHaveAttribute("aria-expanded", "false");
  });

  it("starts open for the organizer, who has people to manage", async () => {
    mockSession.data = { user: { id: "owner-9", name: "Sam" } };
    renderPage({ players: [{ id: "a", name: "Ana Maria", userId: null }, { id: "b", name: "Beto Santos", userId: null }] });
    expect(await screen.findByTestId("whos-in")).toBeInTheDocument();
  });

  it("remembers what the viewer chose for this event, both ways, over the default", async () => {
    const user = userEvent.setup();
    const two = [{ id: "a", name: "Joana Weiss", userId: null }, { id: "b", name: "Jack Weiss", userId: null }];
    renderPage({ players: two });
    await user.click(await screen.findByRole("button", { name: "Who's in" }));
    expect(screen.queryByTestId("whos-in")).not.toBeInTheDocument();
    expect(localStorage.getItem("whos-in:evt-1")).toBe("closed");
    cleanup();
    renderPage({ players: two });
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByTestId("whos-in")).not.toBeInTheDocument();
    cleanup();
    localStorage.clear();
    renderPage({ players: [{ id: "a", name: "Ana Maria", userId: null }] });
    await user.click(await screen.findByRole("button", { name: "Who's in" }));
    expect(localStorage.getItem("whos-in:evt-1")).toBe("open");
    cleanup();
    renderPage({ players: [{ id: "a", name: "Ana Maria", userId: null }] });
    expect(await screen.findByTestId("whos-in")).toBeInTheDocument();
  });

  it("marks the viewer's own name by weight and by the slot, not with a third '(you)'", async () => {
    mockSession.data = { user: { id: "u-1", name: "Jose Silva" } };
    renderPage({ players: [{ id: "a", name: "Jose Silva", userId: "u-1" }, { id: "b", name: "Joana Weiss", userId: null }, { id: "c", name: "Jack Weiss", userId: null }] });
    const list = await screen.findByTestId("whos-in");
    expect(list).not.toHaveTextContent("(you)");
    expect(within(list).getByRole("link", { name: "Jose Silva" })).toBeInTheDocument();
  });
});

describe("Next game — the finished game's teams are never the next game's", () => {
  const teamResults = [
    { id: "t1", name: "Ninjas", members: [{ name: "Player 0", order: 0 }, { name: "Player 1", order: 1 }] },
    { id: "t2", name: "Gunas", members: [{ name: "Player 2", order: 0 }, { name: "Player 3", order: 1 }] },
  ];
  const ended = { isRecurring: true, recurrenceRule: WEEKLY, dateTime: new Date(Date.now() - 3 * HOUR).toISOString(), players: rows(4), teamResults };

  it("shows the teams for an open game", async () => {
    renderPage({ players: rows(4), teamResults });
    expect(await screen.findByRole("heading", { level: 3, name: /^Teams for / })).toBeInTheDocument();
  });

  it("shows the teams while the game is being played", async () => {
    renderPage({ players: rows(4), teamResults, dateTime: new Date(Date.now() - HOUR / 2).toISOString() });
    expect(await screen.findByRole("heading", { level: 3, name: /^Teams for / })).toBeInTheDocument();
  });

  it("hides them between the end of a weekly game and its reset (signups soon), with the frozen roster", async () => {
    renderPage(ended);
    await screen.findByText("Sign-ups open in a moment");
    expect(screen.queryByRole("heading", { name: /^Teams/ })).not.toBeInTheDocument();
    expect(screen.queryByText("Ninjas")).not.toBeInTheDocument();
    expect(screen.queryByText("Player 0")).not.toBeInTheDocument();
  });

  it("hides them after a one-off game ends: its result lives in the recap", async () => {
    renderPage({ ...ended, isRecurring: false, recurrenceRule: null });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("heading", { name: /^Teams/ })).not.toBeInTheDocument();
  });

  it("hides them on a cancelled game", async () => {
    renderPage({ players: rows(4), teamResults, gameStatus: "cancelled" });
    await screen.findByRole("heading", { level: 2, name: "This game was cancelled" });
    expect(screen.queryByRole("heading", { name: /^Teams/ })).not.toBeInTheDocument();
  });
});

describe("Next game — a cancelled game keeps a read-only roster", () => {
  it("lists who was in, with no way to join, add or remove", async () => {
    renderPage({ gameStatus: "cancelled", players: [{ id: "a", name: "Ana Maria", userId: null }, { id: "b", name: "Beto", userId: null }], ownerId: "u-1" });
    const list = await screen.findByTestId("whos-in");
    expect(within(list).getByText("Ana Maria")).toBeInTheDocument();
    expect(within(list).getByText("Beto")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I'm in" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add a friend" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Options for/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("lineup-slots")).not.toBeInTheDocument();
  });

  it("says nothing extra when nobody was in", async () => {
    renderPage({ gameStatus: "cancelled", players: [] });
    await screen.findByRole("heading", { level: 2, name: "This game was cancelled" });
    expect(screen.queryByTestId("whos-in")).not.toBeInTheDocument();
  });
});
