import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor, fireEvent, act, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import LineupPage from "~/components/LineupPage";
import { fakeServer, makeEvent, respond, type Row } from "./eventPageHarness";
import { cssFor } from "../emotionCss";

const mockSession = { data: { user: { id: "owner-9", name: "Sam" } } as { user: { id: string; name: string } } | null, isPending: false, refetch: vi.fn() };
vi.mock("~/lib/auth.client", () => ({ useSession: () => mockSession, signOut: vi.fn() }));

const players: Row[] = [
  { id: "a", name: "Ana", userId: null }, { id: "b", name: "Beto", userId: "u-b" },
  { id: "c", name: "Cris", userId: null }, { id: "d", name: "Duda", userId: null },
];
let server: ReturnType<typeof fakeServer>;
function renderPage(over: Record<string, unknown> = {}, setup?: (s: ReturnType<typeof fakeServer>) => void) {
  server = fakeServer(makeEvent({ maxPlayers: 3, players: players.map((p) => ({ ...p })), ...over }));
  setup?.(server);
  server.install();
  return renderWithTheme(<LineupPage eventId="evt-1" />);
}

beforeEach(() => { mockSession.data = { user: { id: "owner-9", name: "Sam" } }; });
afterEach(() => { cleanup(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Manage lineup — who may open it", () => {
  it("tells a signed-out visitor to sign in as the organizer and shows no list", async () => {
    mockSession.data = null;
    renderPage();
    expect(await screen.findByText("Only the organizer can manage the lineup.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign in as the organizer to manage the lineup." })).toBeInTheDocument();
    expect(screen.queryByText(/Ana/)).not.toBeInTheDocument();
  });

  it("tells a player it is the organizer's page", async () => {
    mockSession.data = { user: { id: "u-b", name: "Beto" } };
    renderPage();
    expect(await screen.findByText("Only the organizer can manage the lineup.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
  });

  it("opens for the owner and for an event admin", async () => {
    renderPage();
    expect(await screen.findByRole("heading", { level: 1, name: "Manage lineup" })).toBeInTheDocument();
    expect(await screen.findByText(/Ana/)).toBeInTheDocument();
    cleanup();
    mockSession.data = { user: { id: "someone", name: "Admin" } };
    renderPage({ isAdmin: true });
    expect(await screen.findByText(/Ana/)).toBeInTheDocument();
  });

  it("links back to the game", async () => {
    renderPage();
    expect(await screen.findByRole("link", { name: "Back to game" })).toHaveAttribute("href", "/events/evt-1");
  });
});

describe("Manage lineup — the order", () => {
  it("numbers the players and the bench separately", async () => {
    renderPage();
    expect(await screen.findByText("1. Ana")).toBeInTheDocument();
    expect(screen.getByText("3. Cris")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Playing (3 of 3)" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Bench (1)" })).toBeInTheDocument();
    expect(screen.getByText("1. Duda")).toBeInTheDocument();
  });

  it("moves a player with the arrows, which is the keyboard and screen-reader way", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Move Beto up" }));
    await waitFor(() => expect(server.sent("PUT", "/reorder-players")).toHaveLength(1));
    expect(server.sent("PUT", "/reorder-players")[0].body).toEqual({ playerIds: ["b", "a", "c", "d"] });
    expect(screen.getByRole("button", { name: "Move Ana up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move Duda down" })).toBeDisabled();
  });

  it("moves a player by dragging", async () => {
    renderPage();
    const rows = (await screen.findAllByRole("listitem"));
    fireEvent.dragStart(rows[0]);
    fireEvent.dragOver(rows[2]);
    fireEvent.drop(rows[2]);
    await waitFor(() => expect(server.sent("PUT", "/reorder-players")).toHaveLength(1));
    expect(server.sent("PUT", "/reorder-players")[0].body).toEqual({ playerIds: ["b", "c", "a", "d"] });
  });

  it("says a failed reorder in plain words and reads the list again", async () => {
    const user = userEvent.setup();
    renderPage({}, (s) => s.on("PUT", "/reorder-players", () => respond(400, { error: "playerIds must contain exactly the current players." })));
    await user.click(await screen.findByRole("button", { name: "Move Beto up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the change. Check your connection and try again.");
    expect(screen.queryByText(/playerIds/)).not.toBeInTheDocument();
    await waitFor(() => expect(server.sent("GET", "/api/events/evt-1").length).toBeGreaterThan(1));
  });

  it("goes back to sign-up order only after asking", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Reset order to sign-up order" }));
    expect(await screen.findByRole("dialog", { name: "Back to sign-up order?" })).toBeInTheDocument();
    expect(server.sent("POST", "/reset-player-order")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Keep my order" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(server.sent("POST", "/reset-player-order")).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Reset order to sign-up order" }));
    await user.click(await screen.findByRole("button", { name: "Reset order" }));
    await waitFor(() => expect(server.sent("POST", "/reset-player-order")).toHaveLength(1));
  });

  it("offers Undo after a reset, which puts back the order that was there", async () => {
    const user = userEvent.setup();
    renderPage({}, (s) => {
      s.on("POST", "/reset-player-order", () => { s.state.event.players = [...players.map((p) => ({ ...p }))]; return { ok: true }; });
      s.on("PUT", "/reorder-players", (c) => { s.state.event.players = (c.body?.playerIds as string[]).map((id) => s.state.event.players.find((p: Row) => p.id === id)); return { ok: true }; });
    });
    await user.click(await screen.findByRole("button", { name: "Move Beto up" }));
    await waitFor(() => expect(screen.getByText("1. Beto")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Reset order to sign-up order" }));
    await user.click(await screen.findByRole("button", { name: "Reset order" }));
    const toast = await screen.findByTestId("undo-toast");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(toast).toHaveTextContent("Order reset");
    await user.click(within(toast).getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.sent("PUT", "/reorder-players")).toHaveLength(2));
    expect(server.sent("PUT", "/reorder-players")[1].body).toEqual({ playerIds: ["b", "a", "c", "d"] });
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
  });
});

describe("Manage lineup — arrows first, and a tap is never lost", () => {
  it("leads with the arrows: the hint says use them, or drag on a desktop", async () => {
    renderPage();
    expect(await screen.findByText("Use the arrows to change the order, or drag on a desktop. The first 3 play; the rest wait on the bench.")).toBeInTheDocument();
  });

  it("puts the arrows before the name in every row, and the drag grip only where a mouse can use it", async () => {
    renderPage();
    const first = (await screen.findAllByRole("listitem"))[0];
    const up = within(first).getByRole("button", { name: "Move Ana up" });
    const name = within(first).getByText("1. Ana");
    expect(up.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const grip = first.querySelector("[data-testid=drag-grip]") as HTMLElement;
    // jsdom has no pointer, so the rule is read from the style: gone on touch screens, there for a mouse.
    expect(cssFor(grip)).toMatch(/@media \(pointer:\s*coarse\)\s*\{[^}]*display:\s*none/);
  });

  it("shows the new order at once, and two quick taps both count — each computed from the latest order", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    renderPage({ maxPlayers: 4 }, (s) => s.on("PUT", "/reorder-players", async (c) => { await gate; s.state.event.players = (c.body?.playerIds as string[]).map((id) => s.state.event.players.find((p: Row) => p.id === id)); return { ok: true }; }));
    await user.click(await screen.findByRole("button", { name: "Move Beto up" }));
    await user.click(screen.getByRole("button", { name: "Move Cris up" }));
    expect(screen.getAllByRole("listitem").map((li) => li.textContent?.replace(/^\d+\. /, "").replace(/\s+/g, " ").trim())).toEqual(["Beto", "Cris", "Ana", "Duda"].map((n) => expect.stringContaining(n)));
    release();
    await waitFor(() => expect(server.sent("PUT", "/reorder-players")).toHaveLength(2));
    expect(server.sent("PUT", "/reorder-players").map((c) => c.body?.playerIds)).toEqual([["b", "a", "c", "d"], ["b", "c", "a", "d"]]);
    await waitFor(() => expect(screen.getByText("2. Cris")).toBeInTheDocument());
  });

  it("puts the order back and says so when a move cannot be saved", async () => {
    const user = userEvent.setup();
    renderPage({}, (s) => s.on("PUT", "/reorder-players", () => respond(500, { error: "x" })));
    await user.click(await screen.findByRole("button", { name: "Move Beto up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the change.");
    await waitFor(() => expect(screen.getByText("2. Beto")).toBeInTheDocument());
  });
});

describe("Manage lineup — the page in the viewer's language", () => {
  afterEach(() => { localStorage.removeItem("convocados-locale"); document.documentElement.lang = "en"; document.title = ""; });

  it("sets the page language and a title from the locale and the game", async () => {
    localStorage.setItem("convocados-locale", "pt");
    renderPage();
    await screen.findByRole("heading", { level: 1, name: "Gerir a lista" });
    expect(document.documentElement.lang).toBe("pt");
    await waitFor(() => expect(document.title).toBe("Gerir a lista — Monday Football"));
  });
});

describe("Manage lineup — states with a way out", () => {
  it("says a locked game is locked, and links to the game to enter the password", async () => {
    renderPage({}, (s) => { s.state.event = { locked: true, id: "evt-1", title: "Monday Football" }; });
    expect(await screen.findByText("This game is locked with a password. Open the game, enter it, then come back.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to game" })).toHaveAttribute("href", "/events/evt-1");
    expect(screen.queryByText("Something went wrong")).not.toBeInTheDocument();
  });

  it("says a game that does not exist is not found", async () => {
    renderPage({}, (s) => s.on("GET", "/api/events/evt-1", () => respond(404, { error: "Not found." })));
    expect(await screen.findByText("Game not found")).toBeInTheDocument();
    expect(screen.getByText("This link may be invalid or expired.")).toBeInTheDocument();
  });

  it("offers 'Try again' when the game cannot be read, and it reads again", async () => {
    const user = userEvent.setup();
    let fail = true;
    renderPage({}, (s) => s.on("GET", "/api/events/evt-1", () => (fail ? respond(500, { error: "x" }) : s.state.event)));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't load the game. Check your connection and try again.");
    fail = false;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("1. Ana")).toBeInTheDocument();
  });

  it("tells a signed-in player who is not the organizer, and links back to the game", async () => {
    mockSession.data = { user: { id: "u-b", name: "Beto" } };
    renderPage();
    expect(await screen.findByText("Only the organizer can manage the lineup.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to game" })).toHaveAttribute("href", "/events/evt-1");
  });
});

describe("Manage lineup — positions", () => {
  it("offers a position per player only when the event uses positions", async () => {
    renderPage({ positionsEnabled: false });
    await screen.findByText(/Ana/);
    expect(screen.queryByLabelText(/Position: Ana/)).not.toBeInTheDocument();
    cleanup();
    renderPage({ positionsEnabled: true });
    expect(await screen.findByLabelText(/Position: Ana/)).toBeInTheDocument();
  });

  it("saves a position by name", async () => {
    const user = userEvent.setup();
    renderPage({ positionsEnabled: true });
    await user.click(await screen.findByLabelText(/Position: Ana/));
    await user.click(await screen.findByRole("option", { name: "Goalkeeper" }));
    await waitFor(() => expect(server.sent("PATCH", "/players")).toHaveLength(1));
    expect(server.sent("PATCH", "/players")[0].body).toEqual({ name: "Ana", position: "GK" });
  });
});

describe("Manage lineup — remove, and Undo", () => {
  it("removes an anonymous player at once and offers Undo with a shrinking line", async () => {
    const user = userEvent.setup();
    renderPage({}, (s) => s.on("DELETE", "/players", () => ({ ok: true, undo: { name: "Ana", order: 0, userId: null, removedAt: Date.now() } })));
    await user.click(await screen.findByRole("button", { name: "Remove Ana" }));
    expect(await screen.findByTestId("undo-toast")).toHaveTextContent("Ana removed");
    expect(screen.getByTestId("undo-progress")).toBeInTheDocument();
    expect(server.sent("DELETE", "/players")[0].body).toEqual({ playerId: "a" });
    expect(screen.getByTestId("undo-toast")).toHaveAttribute("role", "status");
  });

  it("asks before removing a player who has an account, in the organizer's words", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole("button", { name: "Remove Beto" }));
    expect(await screen.findByText(/Remove Beto/i)).toBeInTheDocument();
    expect(server.sent("DELETE", "/players")).toHaveLength(0);
    await user.click(screen.getByTestId("leave-dialog-confirm"));
    await waitFor(() => expect(server.sent("DELETE", "/players")).toHaveLength(1));
  });

  it("Undo asks the server to put the player back where they were", async () => {
    const user = userEvent.setup();
    const undo = { name: "Ana", order: 0, userId: null, removedAt: Date.now() };
    renderPage({}, (s) => s.on("DELETE", "/players", () => ({ ok: true, undo })));
    await user.click(await screen.findByRole("button", { name: "Remove Ana" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.sent("POST", "/undo-remove")).toHaveLength(1));
    expect(server.sent("POST", "/undo-remove")[0].body).toMatchObject({ name: "Ana", order: 0, userId: null });
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
  });

  it("puts the player back and says so when the removal fails", async () => {
    const user = userEvent.setup();
    renderPage({}, (s) => s.on("DELETE", "/players", () => respond(500, { error: "x" })));
    await user.click(await screen.findByRole("button", { name: "Remove Cris" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't remove Cris.");
    expect(screen.getByText("3. Cris")).toBeInTheDocument();
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
  });

  it("closes the Undo after the server's 60 seconds, with one timeout", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setTimeout", "clearTimeout"] });
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderPage({}, (s) => s.on("DELETE", "/players", () => ({ ok: true, undo: { name: "Ana", order: 0, userId: null, removedAt: Date.now() } })));
    await user.click(await screen.findByRole("button", { name: "Remove Ana" }));
    await screen.findByTestId("undo-toast");
    await act(async () => { await vi.advanceTimersByTimeAsync(59_000); });
    expect(screen.getByTestId("undo-toast")).toBeInTheDocument();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
  });
});
