import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import EventPage from "~/components/EventPage";
import { fakeServer, makeEvent, respond, type Row } from "./eventPageHarness";
import { cssFor } from "../emotionCss";

const mockSession = { data: { user: { id: "u-1", name: "Jose Silva" } } as { user: { id: string; name: string } } | null, isPending: false, refetch: vi.fn() };
vi.mock("~/lib/auth.client", () => ({ useSession: () => mockSession, signOut: vi.fn() }));

const rows = (n: number, from = 0): Row[] => Array.from({ length: n }, (_, i) => ({ id: `p${from + i}`, name: `Player ${from + i}`, userId: null }));
const OWNER = { user: { id: "owner-9", name: "Sam" } };

let server: ReturnType<typeof fakeServer>;
function renderPage(over: Record<string, unknown> = {}, setup?: (s: ReturnType<typeof fakeServer>) => void) {
  server = fakeServer(makeEvent(over));
  // The server adds whoever is posted, like POST /players does, and removes whoever is deleted.
  server.on("POST", "/players", (c) => { const name = String(c.body?.name); server.state.event.players.push({ id: `srv-${name}`, name, userId: null }); return { ok: true, resolvedName: name, anonymous: true }; });
  server.on("DELETE", "/players", (c) => {
    const gone = server.state.event.players.find((p: Row) => p.id === c.body?.playerId);
    server.state.event.players = server.state.event.players.filter((p: Row) => p.id !== c.body?.playerId);
    return { ok: true, undo: { name: gone?.name, order: 0, userId: gone?.userId ?? null, removedAt: Date.now() } };
  });
  setup?.(server);
  server.install();
  return renderWithTheme(<EventPage eventId="evt-1" />);
}
const openPanel = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(await screen.findByRole("button", { name: "Add a friend" }));
  return await screen.findByRole("textbox", { name: "Their name or email" });
};

beforeEach(() => {
  mockSession.data = { user: { id: "u-1", name: "Jose Silva" } };
  window.history.pushState({}, "", "/events/evt-1");
  localStorage.clear();
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); delete (navigator as { contacts?: unknown }).contacts; });

describe("Add a friend — the panel", () => {
  it("opens with the cursor in the one field, and the primary action says what it will do", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(3) });
    const field = await openPanel(user);
    expect(field).toHaveFocus();
    expect(field).toHaveAttribute("maxlength", "120");
    expect(screen.getByRole("button", { name: "Add to the game" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add a friend" })).toHaveAttribute("aria-expanded", "true");
  });

  it("is offered to a signed-out visitor too, as the server allows (they add anonymous names)", async () => {
    mockSession.data = null;
    renderPage({ players: rows(3) });
    expect(await screen.findByRole("button", { name: "Add a friend" })).toBeInTheDocument();
  });

  it("is not offered on a cancelled game, or once the game has ended", async () => {
    renderPage({ gameStatus: "cancelled" });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Add a friend" })).not.toBeInTheDocument();
    cleanup();
    renderPage({ dateTime: new Date(Date.now() - 3 * 3_600_000).toISOString() });
    await screen.findByRole("heading", { level: 1 });
    expect(screen.queryByRole("button", { name: "Add a friend" })).not.toBeInTheDocument();
  });

  it("adds a typed name with Enter: the slot fills at once, the request has an idempotency key, and the panel stays open for the next one", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(2) });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    server.on("POST", "/players", async (c) => { await gate; server.state.event.players.push({ id: "srv-rui", name: String(c.body?.name), userId: null }); return { ok: true, resolvedName: "Rui", anonymous: true }; });
    const field = await openPanel(user);
    await user.type(field, "Rui{Enter}");
    await waitFor(() => expect(screen.getByTestId("lineup-summary")).toHaveTextContent("3 of 10 are in"));
    release();
    expect(await screen.findByText("Added Rui ✓")).toBeInTheDocument();
    const call = server.sent("POST", "/players")[0];
    expect(call.body).toEqual({ name: "Rui", linkToAccount: false });
    expect(call.headers["Idempotency-Key"]).toEqual(expect.any(String));
    expect(screen.getByTestId("add-friend-panel")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Their name or email" })).toHaveFocus());
    expect(screen.getByRole("textbox", { name: "Their name or email" })).toHaveValue("");
  });

  it("tells the viewer who the server matched, not only what they typed", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(1) }, (s) => s.on("POST", "/players", () => ({ ok: true, resolvedName: "Rui Costa", anonymous: false })));
    await user.type(await openPanel(user), "rui{Enter}");
    expect(await screen.findByText("Added Rui Costa ✓")).toBeInTheDocument();
  });

  it("says 'Add to the bench' and why when the game is full", async () => {
    const user = userEvent.setup();
    renderPage({ maxPlayers: 3, players: rows(3) });
    await openPanel(user);
    expect(screen.getByRole("button", { name: "Add to the bench" })).toBeInTheDocument();
    expect(screen.getByText("The game is full, so they go on the bench and move up if someone drops out.")).toBeInTheDocument();
  });

  it("refuses a name that is already in, in plain words and without asking the server (case and accents ignored)", async () => {
    const user = userEvent.setup();
    renderPage({ players: [{ id: "a", name: "José Costa", userId: null }] });
    await user.type(await openPanel(user), "jose costa{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("jose costa is already in the list.");
    expect(server.sent("POST", "/players")).toHaveLength(0);
  });

  it("refuses a name that is already invited", async () => {
    const user = userEvent.setup();
    renderPage({ invited: [{ id: "i1", inviteId: "x", name: "Mia R", userId: null, image: null }] });
    await user.type(await openPanel(user), "Mia R{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Mia R is already in the list.");
  });

  it("shows the server's duplicate answer inline too", async () => {
    const user = userEvent.setup();
    renderPage({}, (s) => s.on("POST", "/players", () => respond(409, { error: "\"Rui\" is already in the list.", code: "ALREADY_IN_ROSTER" })));
    await user.type(await openPanel(user), "Rui{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Rui is already in the list.");
    expect(screen.queryAllByTestId("slot")).toHaveLength(0);
  });

  it("cannot be submitted twice: two Enters send one request", async () => {
    const user = userEvent.setup();
    renderPage();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    server.on("POST", "/players", async () => { await gate; return { ok: true, resolvedName: "Rui" }; });
    await user.type(await openPanel(user), "Rui{Enter}");
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Their name or email" }), { key: "Enter" });
    expect(screen.getByRole("button", { name: "Add to the game" })).toBeDisabled();
    release();
    await waitFor(() => expect(server.sent("POST", "/players")).toHaveLength(1));
  });

  it("rolls the slot back and says so inline when the server fails", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(2) }, (s) => s.on("POST", "/players", () => respond(500, { error: "x" })));
    await user.type(await openPanel(user), "Rui{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't add them. Check your connection and try again.");
    expect(screen.getAllByTestId("slot")).toHaveLength(2);
    expect(screen.getByRole("textbox", { name: "Their name or email" })).toHaveValue("Rui");
  });

  it("says the bench is full in plain words", async () => {
    const user = userEvent.setup();
    renderPage({ maxPlayers: 2 }, (s) => s.on("POST", "/players", () => respond(400, { error: "The bench is full (maximum 2 bench players)." })));
    await user.type(await openPanel(user), "Rui{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("The bench is full (maximum 2 bench players).");
  });

  it("closes with the × or Escape and puts focus back on the button", async () => {
    const user = userEvent.setup();
    renderPage();
    await openPanel(user);
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("add-friend-panel")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add a friend" })).toHaveFocus());
  });

  it("opens from an open slot", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(1) });
    await screen.findByTestId("lineup-slots");
    await user.click(screen.getAllByTestId("open-slot")[0]);
    expect(await screen.findByTestId("add-friend-panel")).toBeInTheDocument();
  });
});

describe("Add a friend — played with you before", () => {
  const setup = (s: ReturnType<typeof fakeServer>) => {
    s.on("GET", "/known-players", () => ({ players: [{ name: "Zoe Lima", gamesPlayed: 4, userId: null }, { name: "Player 0", gamesPlayed: 9, userId: null }] }));
    s.on("GET", "/co-players", () => ({ players: [{ name: "Frank Ode", userId: "u-f", image: null, coPlayCount: 3 }] }));
  };

  it("offers people not already in, known here or from other games, and adds one with a tap", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(1) }, setup);
    await openPanel(user);
    expect(await screen.findByRole("button", { name: "Zoe Lima" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Frank Ode" })).toBeInTheDocument();
    expect(within(screen.getByTestId("add-friend-panel")).queryByRole("button", { name: "Player 0" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Zoe Lima" }));
    await waitFor(() => expect(server.sent("POST", "/players")).toHaveLength(1));
    expect(server.sent("POST", "/players")[0].body).toEqual({ name: "Zoe Lima", linkToAccount: false });
  });

  it("writes why each person is suggested right on the chip, not only in a tooltip", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(1) }, setup);
    await openPanel(user);
    const zoe = await screen.findByRole("button", { name: "Zoe Lima" });
    expect(within(zoe).getByText("4 games here")).toBeVisible();
    expect(zoe).toHaveAccessibleDescription("4 games here");
    expect(within(screen.getByRole("button", { name: "Frank Ode" })).getByText("Played with you 3×")).toBeVisible();
  });

  it("says '1 game here' in the singular", async () => {
    const user = userEvent.setup();
    renderPage({}, (s) => s.on("GET", "/known-players", () => ({ players: [{ name: "Zoe Lima", gamesPlayed: 1, userId: null }] })));
    await openPanel(user);
    expect(within(await screen.findByRole("button", { name: "Zoe Lima" })).getByText("1 game here")).toBeVisible();
  });

  it("narrows the chips to what is typed, ignoring case and accents, while the typed text can still be added as it is", async () => {
    const user = userEvent.setup();
    renderPage({}, (s) => s.on("GET", "/known-players", () => ({ players: [{ name: "José Costa", gamesPlayed: 4, userId: null }, { name: "Zoe Lima", gamesPlayed: 2, userId: null }, { name: "Joana Reis", gamesPlayed: 1, userId: null }] })));
    const field = await openPanel(user);
    await screen.findByRole("button", { name: "Zoe Lima" });
    await user.type(field, "jose");
    expect(screen.getByRole("button", { name: "José Costa" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Zoe Lima" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Joana Reis" })).not.toBeInTheDocument();
    // Nobody matches: the heading goes with the chips, and the typed name is still addable.
    await user.type(field, "x");
    expect(screen.queryByTestId("friend-chips")).not.toBeInTheDocument();
    expect(screen.queryByText("Played with you before")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add to the game" })).toBeEnabled();
    // Clearing the field brings every chip back.
    await user.clear(field);
    expect(screen.getByRole("button", { name: "Zoe Lima" })).toBeInTheDocument();
  });

  it("shows no chips next to an email: nobody is a match for an address", async () => {
    const user = userEvent.setup();
    renderPage({}, setup);
    const field = await openPanel(user);
    await screen.findByRole("button", { name: "Zoe Lima" });
    await user.type(field, "zoe@example.com");
    expect(screen.queryByTestId("friend-chips")).not.toBeInTheDocument();
  });

  it("reads nothing until the panel is opened", async () => {
    renderPage({ players: rows(1) }, setup);
    await screen.findByTestId("lineup-slots");
    expect(server.sent("GET", "/known-players")).toHaveLength(0);
    expect(server.sent("GET", "/co-players")).toHaveLength(0);
  });

  it("gives an organizer the ranked suggestions first, with the reason written under the name", async () => {
    mockSession.data = OWNER;
    const user = userEvent.setup();
    renderPage({ players: rows(1), gameId: "g1" }, (s) => { setup(s); s.on("GET", "/suggestions", () => ({ suggestions: [{ userId: "u-g", name: "Grace Hall", reason: "Plays every week" }] })); });
    await openPanel(user);
    const grace = await screen.findByRole("button", { name: "Grace Hall" });
    expect(grace).toHaveAccessibleDescription("Plays every week");
    expect(within(grace).getByText("Plays every week")).toBeVisible();
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label") ?? b.textContent);
    expect(names.indexOf("Grace Hall")).toBeLessThan(names.indexOf("Zoe Lima"));
  });

  it("does not ask a player for the organizer's suggestions", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(1), gameId: "g1" }, setup);
    await openPanel(user);
    await screen.findByRole("button", { name: "Zoe Lima" });
    expect(server.sent("GET", "/suggestions")).toHaveLength(0);
  });

  it("shows eight and a 'show more' for the rest", async () => {
    const user = userEvent.setup();
    const many = Array.from({ length: 11 }, (_, i) => ({ name: `Friend ${i}`, gamesPlayed: 11 - i, userId: null }));
    renderPage({}, (s) => s.on("GET", "/known-players", () => ({ players: many })));
    await openPanel(user);
    await screen.findByRole("button", { name: "Friend 0" });
    expect(screen.queryByRole("button", { name: "Friend 9" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show more suggestions" }));
    expect(screen.getByRole("button", { name: "Friend 10" })).toBeInTheDocument();
  });
});

describe("Add a friend — position, email, link, several", () => {
  it("asks for a position only when the event uses them, and sends it", async () => {
    const user = userEvent.setup();
    renderPage({ positionsEnabled: false });
    await openPanel(user);
    expect(screen.queryByLabelText("Position")).not.toBeInTheDocument();
    cleanup();
    renderPage({ positionsEnabled: true });
    const field = await openPanel(user);
    await user.click(screen.getByLabelText("Position"));
    await user.click(await screen.findByRole("option", { name: "Goalkeeper" }));
    await user.type(field, "Rui{Enter}");
    await waitFor(() => expect(server.sent("POST", "/players")).toHaveLength(1));
    expect(server.sent("POST", "/players")[0].body).toEqual({ name: "Rui", linkToAccount: false, position: "GK" });
  });

  it("invites a registered email, says how it went out, and hands over the invite link", async () => {
    const user = userEvent.setup();
    renderPage({}, (s) => s.on("POST", "/invites", () => ({ ok: true, channels: { email: true, webPush: false, appPush: false }, inviteUrl: "https://x.test/i/abc" })));
    await user.type(await openPanel(user), "rui@example.com{Enter}");
    expect(await screen.findByText("Invite sent to rui@example.com via email")).toBeInTheDocument();
    expect(server.sent("POST", "/invites")[0].body).toEqual({ email: "rui@example.com" });
    expect(server.sent("POST", "/players")).toHaveLength(0);
    expect(await screen.findByDisplayValue("https://x.test/i/abc")).toBeInTheDocument();
  });

  describe("an email nobody has registered", () => {
    const unregistered = (s: ReturnType<typeof fakeServer>, invited: string | null = "emailed") => {
      s.on("POST", "/invites", () => respond(404, { error: "No registered user with that email." }));
      s.on("POST", "/players", (c) => { s.state.event.players.push({ id: `srv-${c.body?.name}`, name: String(c.body?.name), userId: null }); return { ok: true, resolvedName: String(c.body?.name), anonymous: true, invited }; });
    };

    it("asks 'What's their name?' instead of publishing the part before the @, and says who can see it", async () => {
      const user = userEvent.setup();
      renderPage({}, unregistered);
      await user.type(await openPanel(user), "new.person@example.com{Enter}");
      const field = await screen.findByRole("textbox", { name: /What's their name\?/ });
      expect(field).toHaveFocus();
      expect(field).toBeRequired();
      expect(screen.getByText("Everyone in this game will see the name. We send new.person@example.com an invitation, and the address stays private.")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Add to the game" })).toBeDisabled();
      expect(server.sent("POST", "/players")).toHaveLength(0);
    });

    it("adds them under the name that was typed, with the email for the invitation, and says it went out", async () => {
      const user = userEvent.setup();
      renderPage({}, unregistered);
      await user.type(await openPanel(user), "new.person@example.com{Enter}");
      await user.type(await screen.findByRole("textbox", { name: /What's their name\?/ }), "Rui Costa{Enter}");
      expect(await screen.findByText("Added Rui Costa. We emailed new.person@example.com an invitation to join Convocados.")).toBeInTheDocument();
      expect(server.sent("POST", "/players")[0].body).toEqual({ name: "Rui Costa", linkToAccount: false, email: "new.person@example.com" });
      // The registered-user check is not asked twice.
      expect(server.sent("POST", "/invites")).toHaveLength(1);
      // Back to the one field, ready for the next person.
      await waitFor(() => expect(screen.getByRole("textbox", { name: "Their name or email" })).toHaveFocus());
    });

    it("never publishes the address as a name: the name is required", async () => {
      const user = userEvent.setup();
      renderPage({}, unregistered);
      await user.type(await openPanel(user), "new.person@example.com{Enter}");
      await user.type(await screen.findByRole("textbox", { name: /What's their name\?/ }), "   {Enter}");
      expect(server.sent("POST", "/players")).toHaveLength(0);
      expect(screen.getByRole("button", { name: "Add to the game" })).toBeDisabled();
    });

    it("Escape or 'Change the email' goes back to the field with the email still in it", async () => {
      const user = userEvent.setup();
      renderPage({}, unregistered);
      await user.type(await openPanel(user), "new.person@example.com{Enter}");
      await screen.findByRole("textbox", { name: /What's their name\?/ });
      await user.keyboard("{Escape}");
      const field = await screen.findByRole("textbox", { name: "Their name or email" });
      expect(field).toHaveValue("new.person@example.com");
      expect(screen.getByTestId("add-friend-panel")).toBeInTheDocument();
    });

    it("says plainly when no invitation email could go out because of the limits", async () => {
      const user = userEvent.setup();
      renderPage({}, (s) => unregistered(s, null));
      await user.type(await openPanel(user), "new.person@example.com{Enter}");
      await user.type(await screen.findByRole("textbox", { name: /What's their name\?/ }), "Rui{Enter}");
      expect(await screen.findByText(/No email went out: invite emails are limited for each game and each person\. Send them an invite link instead\./)).toBeInTheDocument();
    });

    it("uses the name from a contact without asking", async () => {
      const user = userEvent.setup();
      (navigator as unknown as { contacts: unknown }).contacts = { select: vi.fn().mockResolvedValue([{ name: ["Rui Costa"], email: ["rui@example.com"] }]) };
      renderPage({}, unregistered);
      await openPanel(user);
      await user.click(screen.getByRole("button", { name: "Add from contacts" }));
      expect(await screen.findByText("Added Rui Costa. We emailed rui@example.com an invitation to join Convocados.")).toBeInTheDocument();
      expect(screen.queryByRole("textbox", { name: /What's their name\?/ })).not.toBeInTheDocument();
    });

    it("in a list, emails without names go on as Guest, Guest 2 — never the address", async () => {
      const user = userEvent.setup();
      renderPage({}, unregistered);
      await openPanel(user);
      await user.click(screen.getByRole("button", { name: "Add several" }));
      await user.type(screen.getByRole("textbox", { name: "One name per line. You can paste a list." }), "a@example.com{Enter}b@example.com{Enter}Carla");
      await user.click(screen.getByRole("button", { name: "Add them all" }));
      expect(await screen.findByText("Added 3 people ✓")).toBeInTheDocument();
      expect(server.sent("POST", "/players").map((c) => c.body?.name)).toEqual(["Guest", "Guest 2", "Carla"]);
    });
  });

  describe("when the invite cannot be sent, it says so in the same plain words as adding", () => {
    it("429: the same sentence as a rate limit on adding a name", async () => {
      const user = userEvent.setup();
      renderPage({}, (s) => s.on("POST", "/invites", () => respond(429, { error: "Too many requests." })));
      await user.type(await openPanel(user), "rui@example.com{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries in a row. Wait a minute and try again.");
    });

    it("429 on the invite link too", async () => {
      const user = userEvent.setup();
      renderPage({}, (s) => s.on("POST", "/invites", () => respond(429, { error: "Too many requests." })));
      await user.type(await openPanel(user), "Rui");
      await user.click(screen.getByRole("button", { name: "Send an invite link instead" }));
      expect(await screen.findByRole("alert")).toHaveTextContent("Too many tries in a row. Wait a minute and try again.");
    });

    it("403: says who may invite", async () => {
      const user = userEvent.setup();
      renderPage({}, (s) => s.on("POST", "/invites", () => respond(403, { error: "Only the owner, an admin, or a player of this event can send invites." })));
      await user.type(await openPanel(user), "rui@example.com{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent("Only people in this game and the organizer can invite.");
    });

    it("409: says they are already in the list, or said they can't make it", async () => {
      const user = userEvent.setup();
      renderPage({}, (s) => s.on("POST", "/invites", () => respond(409, { error: "This player is already on the player list." })));
      await user.type(await openPanel(user), "rui@example.com{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent("rui@example.com is already in the list.");
      cleanup();
      const user2 = userEvent.setup();
      renderPage({}, (s) => s.on("POST", "/invites", () => respond(409, { error: "This player declined this game." })));
      await user2.type(await openPanel(user2), "rui@example.com{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent("rui@example.com said they can't make it.");
    });

    it("anything else: the plain 'couldn't add' sentence, not the server's", async () => {
      const user = userEvent.setup();
      renderPage({}, (s) => s.on("POST", "/invites", () => respond(500, { error: "SQLITE_BUSY" })));
      await user.type(await openPanel(user), "rui@example.com{Enter}");
      expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't add them. Check your connection and try again.");
    });
  });

  it("asks a signed-out visitor to sign in, or type a name, instead of an email", async () => {
    mockSession.data = null;
    const user = userEvent.setup();
    renderPage();
    await user.type(await openPanel(user), "rui@example.com{Enter}");
    expect(await screen.findByRole("alert")).toHaveTextContent("Sign in to invite by email, or type their name instead.");
    expect(server.sent("POST", "/invites")).toHaveLength(0);
    expect(server.sent("POST", "/players")).toHaveLength(0);
  });

  it("makes an invite link without notifying anyone, and offers copy and share", async () => {
    const user = userEvent.setup();
    renderPage({}, (s) => s.on("POST", "/invites", () => ({ ok: true, inviteUrl: "https://x.test/i/link" })));
    await user.type(await openPanel(user), "Rui");
    await user.click(screen.getByRole("button", { name: "Send an invite link instead" }));
    expect(await screen.findByDisplayValue("https://x.test/i/link")).toBeInTheDocument();
    expect(server.sent("POST", "/invites")[0].body).toEqual({ name: "Rui", deliver: false });
    expect(server.sent("POST", "/players")).toHaveLength(0);
  });

  it("never leaves 'Send an invite link instead' looking dead: with nothing typed it says what to do, and moves to the field", async () => {
    const user = userEvent.setup();
    renderPage();
    const field = await openPanel(user);
    const button = screen.getByRole("button", { name: "Send an invite link instead" });
    expect(button).toBeEnabled();
    await user.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Type their name or email first, then we make a link for them.");
    expect(field).toHaveFocus();
    expect(server.sent("POST", "/invites")).toHaveLength(0);
  });

  it("says when the invite link could not be made", async () => {
    const user = userEvent.setup();
    renderPage({}, (s) => s.on("POST", "/invites", () => respond(500, { error: "x" })));
    await user.type(await openPanel(user), "Rui");
    await user.click(screen.getByRole("button", { name: "Send an invite link instead" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't make the invite link. Try again.");
  });

  it("adds a list: each line in turn, then says how many", async () => {
    const user = userEvent.setup();
    renderPage();
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "Add several" }));
    await user.type(screen.getByRole("textbox", { name: "One name per line. You can paste a list." }), "Ana{Enter}Beto{Enter}Carla");
    await user.click(screen.getByRole("button", { name: "Add them all" }));
    expect(await screen.findByText("Added 3 people ✓")).toBeInTheDocument();
    expect(server.sent("POST", "/players").map((c) => c.body?.name)).toEqual(["Ana", "Beto", "Carla"]);
  });

  it("turns a pasted list into 'add several'", async () => {
    const user = userEvent.setup();
    renderPage();
    const field = await openPanel(user);
    await user.click(field);
    await user.paste("Ana\nBeto");
    expect(await screen.findByRole("textbox", { name: "One name per line. You can paste a list." })).toHaveValue("Ana\nBeto");
  });

  it("stops at the first name that cannot be added and keeps the rest in the box", async () => {
    const user = userEvent.setup();
    renderPage({ players: [{ id: "a", name: "Beto", userId: null }] });
    await openPanel(user);
    await user.click(screen.getByRole("button", { name: "Add several" }));
    await user.type(screen.getByRole("textbox", { name: "One name per line. You can paste a list." }), "Ana{Enter}Beto{Enter}Carla");
    await user.click(screen.getByRole("button", { name: "Add them all" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Beto is already in the list.");
    expect(screen.getByRole("textbox", { name: "One name per line. You can paste a list." })).toHaveValue("Beto\nCarla");
    expect(server.sent("POST", "/players")).toHaveLength(1);
  });

  it("picks from contacts where the browser can: a name fills the field, a contact with an email is invited", async () => {
    const user = userEvent.setup();
    (navigator as unknown as { contacts: unknown }).contacts = { select: vi.fn().mockResolvedValue([{ name: ["Rui Costa"], email: [] }]) };
    renderPage();
    const field = await openPanel(user);
    await user.click(screen.getByRole("button", { name: "Add from contacts" }));
    await waitFor(() => expect(field).toHaveValue("Rui Costa"));
    expect(server.sent("POST", "/players")).toHaveLength(0);
  });

  it("does not offer contacts where the browser cannot", async () => {
    const user = userEvent.setup();
    renderPage();
    await openPanel(user);
    expect(screen.queryByRole("button", { name: "Add from contacts" })).not.toBeInTheDocument();
  });
});

describe("Remove — from the slot or the name", () => {
  const withMe = (extra: Row[] = []): Row[] => [{ id: "a", name: "Ana Maria", userId: null }, { id: "b", name: "Beto", userId: "u-b" }, ...extra];

  it("a tap on a slot opens its name with Remove, focus on Remove, and Escape closes it with focus back on the slot", async () => {
    const user = userEvent.setup();
    renderPage({ players: withMe() });
    const slot = await screen.findByRole("button", { name: "Options for Ana Maria" });
    expect(slot).toHaveAttribute("aria-expanded", "false");
    await user.click(slot);
    const options = await screen.findByRole("group", { name: "Options for Ana Maria" });
    expect(within(options).getByRole("button", { name: "Remove Ana Maria" })).toHaveFocus();
    expect(slot).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{Escape}");
    expect(screen.queryByTestId("player-options")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Options for Ana Maria" })).toHaveFocus());
  });

  it("a signed-in player gets options for guests, never for somebody else's account", async () => {
    renderPage({ players: withMe() });
    await screen.findByTestId("lineup-slots");
    expect(screen.getByRole("button", { name: "Options for Ana Maria" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Options for Beto" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Beto" })).toBeInTheDocument();
  });

  it("an organizer may remove anyone", async () => {
    mockSession.data = OWNER;
    renderPage({ players: withMe() });
    expect(await screen.findByRole("button", { name: "Options for Beto" })).toBeInTheDocument();
  });

  it("removes an anonymous player at once, with Undo for the organizer", async () => {
    mockSession.data = OWNER;
    const user = userEvent.setup();
    renderPage({ players: withMe() });
    await user.click(await screen.findByRole("button", { name: "Options for Ana Maria" }));
    await user.click(screen.getByRole("button", { name: "Remove Ana Maria" }));
    expect(await screen.findByTestId("undo-toast")).toHaveTextContent("Ana Maria removed");
    expect(screen.getByTestId("undo-progress")).toBeInTheDocument();
    expect(server.sent("DELETE", "/players")[0].body).toEqual({ playerId: "a" });
    expect(screen.queryByRole("group", { name: "Options for Ana Maria" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add a friend" })).toHaveFocus());
  });

  it("a signed-out visitor cannot take off a name somebody else added: griefing is not a feature", async () => {
    mockSession.data = null;
    renderPage({ players: withMe() });
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByRole("button", { name: "Options for Ana Maria" })).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Ana Maria" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Options for Ana Maria" })).not.toBeInTheDocument();
  });

  it("a signed-out visitor may take back a name this browser added — at once, no Undo (the server would refuse it)", async () => {
    mockSession.data = null;
    const user = userEvent.setup();
    renderPage({ players: withMe() });
    await user.type(await openPanel(user), "Rui{Enter}");
    await screen.findByText("Added Rui ✓");
    await user.click(await screen.findByRole("button", { name: "Options for Rui" }));
    await user.click(screen.getByRole("button", { name: "Remove Rui" }));
    await waitFor(() => expect(server.sent("DELETE", "/players")).toHaveLength(1));
    expect(server.sent("DELETE", "/players")[0].body).toEqual({ playerId: "srv-Rui" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "Options for Rui" })).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
    // …and the name is forgotten: a row of that name added by somebody else later is not this visitor's to remove.
    expect(localStorage.getItem("added-here:evt-1")).toBe("[]");
  });

  it("a signed-out visitor still cannot remove somebody else's row after adding their own", async () => {
    mockSession.data = null;
    const user = userEvent.setup();
    renderPage({ players: withMe() });
    await user.type(await openPanel(user), "Rui{Enter}");
    await screen.findByText("Added Rui ✓");
    expect(screen.queryByRole("button", { name: "Options for Ana Maria" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Options for Rui" })).toBeInTheDocument();
  });

  it("a signed-in player asks first before taking a guest off: 'They will lose their place', and Cancel sends nothing", async () => {
    const user = userEvent.setup();
    renderPage({ players: withMe() });
    await user.click(await screen.findByRole("button", { name: "Options for Ana Maria" }));
    await user.click(screen.getByRole("button", { name: "Remove Ana Maria" }));
    expect(await screen.findByText("Remove Ana Maria?")).toBeInTheDocument();
    expect(screen.getByText("They will lose their place.")).toBeInTheDocument();
    await user.click(screen.getByTestId("leave-dialog-cancel"));
    expect(server.sent("DELETE", "/players")).toHaveLength(0);
    expect(screen.getAllByTestId("slot")).toHaveLength(2);
  });

  it("…then removes them, and does not offer Undo (the server would answer 403)", async () => {
    const user = userEvent.setup();
    renderPage({ players: withMe() });
    await user.click(await screen.findByRole("button", { name: "Options for Ana Maria" }));
    await user.click(screen.getByRole("button", { name: "Remove Ana Maria" }));
    await user.click(await screen.findByTestId("leave-dialog-confirm"));
    await waitFor(() => expect(server.sent("DELETE", "/players")).toHaveLength(1));
    await screen.findByText("Ana Maria removed");
    expect(screen.queryByRole("button", { name: "Undo" })).not.toBeInTheDocument();
  });

  it("an organizer takes a guest off without being asked, as before", async () => {
    mockSession.data = OWNER;
    const user = userEvent.setup();
    renderPage({ players: withMe() });
    await user.click(await screen.findByRole("button", { name: "Options for Ana Maria" }));
    await user.click(screen.getByRole("button", { name: "Remove Ana Maria" }));
    await waitFor(() => expect(server.sent("DELETE", "/players")).toHaveLength(1));
    expect(screen.queryByTestId("leave-dialog-confirm")).not.toBeInTheDocument();
  });

  it("your own slot says Leave; everyone else's says Remove", async () => {
    const user = userEvent.setup();
    renderPage({ players: [{ id: "me", name: "Jose Silva", userId: "u-1" }, ...withMe()] });
    await user.click(await screen.findByRole("button", { name: "Options for Jose Silva (you)" }));
    const own = await screen.findByTestId("player-options");
    expect(within(own).getByRole("button", { name: "Leave" })).toBeInTheDocument();
    expect(within(own).queryByRole("button", { name: /Remove/ })).not.toBeInTheDocument();
    await user.keyboard("{Escape}");
    await user.click(await screen.findByRole("button", { name: "Options for Ana Maria" }));
    expect(within(await screen.findByTestId("player-options")).getByRole("button", { name: "Remove Ana Maria" })).toHaveTextContent("Remove");
  });

  it("Undo puts them back with the details the server gave", async () => {
    mockSession.data = OWNER;
    const user = userEvent.setup();
    renderPage({ players: withMe() });
    await user.click(await screen.findByRole("button", { name: "Options for Ana Maria" }));
    await user.click(screen.getByRole("button", { name: "Remove Ana Maria" }));
    await user.click(await screen.findByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.sent("POST", "/undo-remove")).toHaveLength(1));
    expect(server.sent("POST", "/undo-remove")[0].body).toMatchObject({ name: "Ana Maria", order: 0, userId: null });
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
  });

  it("asks first before removing a player who has an account, in the organizer's words", async () => {
    mockSession.data = OWNER;
    const user = userEvent.setup();
    renderPage({ players: withMe() });
    await user.click(await screen.findByRole("button", { name: "Options for Beto" }));
    await user.click(screen.getByRole("button", { name: "Remove Beto" }));
    expect(await screen.findByText("Remove Beto?")).toBeInTheDocument();
    expect(server.sent("DELETE", "/players")).toHaveLength(0);
    await user.click(screen.getByTestId("leave-dialog-confirm"));
    await waitFor(() => expect(server.sent("DELETE", "/players")).toHaveLength(1));
  });

  it("removing yourself from your own slot is leaving: the leave dialog, not a delete", async () => {
    const user = userEvent.setup();
    renderPage({ players: [{ id: "me", name: "Jose Silva", userId: "u-1" }, ...withMe()] });
    await user.click(await screen.findByRole("button", { name: "Options for Jose Silva (you)" }));
    await user.click(screen.getByRole("button", { name: "Leave" }));
    expect(await screen.findByText("Leave this game?")).toBeInTheDocument();
    expect(server.sent("DELETE", "/players")).toHaveLength(0);
  });

  it("puts the player back and says so when the server refuses", async () => {
    mockSession.data = OWNER;
    const user = userEvent.setup();
    renderPage({ players: withMe() }, (s) => s.on("DELETE", "/players", () => respond(500, { error: "x" })));
    await user.click(await screen.findByRole("button", { name: "Options for Ana Maria" }));
    await user.click(screen.getByRole("button", { name: "Remove Ana Maria" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't remove Ana Maria.");
    expect(screen.getAllByTestId("slot")).toHaveLength(2);
    expect(screen.queryByTestId("undo-toast")).not.toBeInTheDocument();
  });

  it("works from the name in 'Who's in' too", async () => {
    mockSession.data = OWNER;
    const user = userEvent.setup();
    renderPage({ players: withMe() });
    await user.click(await screen.findByRole("button", { name: "Who's in" }));
    await user.click(within(screen.getByTestId("whos-in")).getByRole("button", { name: "Options for Ana Maria" }));
    const options = await screen.findByRole("group", { name: "Options for Ana Maria" });
    await user.click(within(options).getByRole("button", { name: "Remove Ana Maria" }));
    await waitFor(() => expect(server.sent("DELETE", "/players")).toHaveLength(1));
  });
});

describe("Add and remove — a polled list never undoes them", () => {
  it("keeps an added friend through a refetch that was already in flight", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(1) });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    server.on("POST", "/players", async () => { await gate; server.state.event.players.push({ id: "srv", name: "Rui", userId: null }); return { ok: true, resolvedName: "Rui" }; });
    await user.type(await openPanel(user), "Rui{Enter}");
    await waitFor(() => expect(screen.getByTestId("lineup-summary")).toHaveTextContent("2 of 10"));
    window.dispatchEvent(new Event("focus"));
    await new Promise((r) => setTimeout(r, 40));
    expect(screen.getByTestId("lineup-summary")).toHaveTextContent("2 of 10");
    release();
    await waitFor(() => expect(screen.getByTestId("lineup-summary")).toHaveTextContent("2 of 10"));
  });
});

describe("An unlinked row with the viewer's own name (the organizer added them before they signed in)", () => {
  const mine: Row = { id: "j", name: "Jose Silva", userId: null };
  const alreadyIn = (s: ReturnType<typeof fakeServer>) => s.on("POST", "/players", () => respond(409, { error: "\"Jose Silva\" is already in the list.", code: "ALREADY_IN_ROSTER" }));

  it("'I'm in' says 'That's you?' and opens that slot's options, with focus on Leave, instead of a dead-end error", async () => {
    const user = userEvent.setup();
    renderPage({ players: [mine, { id: "a", name: "Ana Maria", userId: null }] }, alreadyIn);
    await user.click(await screen.findByRole("button", { name: "I'm in" }));
    expect(await screen.findByTestId("thats-you")).toHaveTextContent("That's you? Tap your slot to leave or claim it.");
    const options = await screen.findByTestId("player-options");
    expect(within(options).getByRole("button", { name: "Leave" })).toHaveFocus();
    expect(screen.queryByText("Jose Silva is already in the list.")).not.toBeInTheDocument();
  });

  it("leaving from it takes that row off the list; it never links the row to the account", async () => {
    const user = userEvent.setup();
    renderPage({ players: [mine] }, alreadyIn);
    await user.click(await screen.findByRole("button", { name: "I'm in" }));
    await user.click(within(await screen.findByTestId("player-options")).getByRole("button", { name: "Leave" }));
    await user.click(await screen.findByTestId("leave-dialog-confirm"));
    await waitFor(() => expect(server.sent("DELETE", "/players")).toHaveLength(1));
    expect(server.sent("DELETE", "/players")[0].body).toEqual({ playerId: "j" });
    expect(server.sent("POST", "/leave")).toHaveLength(0);
    expect(server.sent("POST", "/claim-player")).toHaveLength(0);
  });

  it("claiming it links the row to the viewer's account and refreshes the list", async () => {
    const user = userEvent.setup();
    renderPage({ players: [mine] }, (s) => {
      alreadyIn(s);
      s.on("POST", "/claim-player", () => { s.state.event.players = [{ id: "j", name: "Jose Silva", userId: "u-1" }]; return { ok: true, claimedPlayerId: "j" }; });
    });
    await user.click(await screen.findByRole("button", { name: "I'm in" }));
    await user.click(within(await screen.findByTestId("player-options")).getByRole("button", { name: "That's me" }));
    await waitFor(() => expect(server.sent("POST", "/claim-player")).toHaveLength(1));
    expect(server.sent("POST", "/claim-player")[0].body).toEqual({ playerId: "j" });
    expect(await screen.findByTestId("rsvp-status")).toHaveTextContent("You're in");
    expect(screen.queryByTestId("player-options")).not.toBeInTheDocument();
  });

  it("says what went wrong when the claim is refused", async () => {
    const user = userEvent.setup();
    renderPage({ players: [mine] }, (s) => { alreadyIn(s); s.on("POST", "/claim-player", () => respond(409, { error: "x" })); });
    await user.click(await screen.findByRole("button", { name: "I'm in" }));
    await user.click(within(await screen.findByTestId("player-options")).getByRole("button", { name: "That's me" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't link Jose Silva to your account.");
  });

  it("an already-in answer for somebody else's name is still the plain error", async () => {
    const user = userEvent.setup();
    renderPage({ players: [{ id: "a", name: "Ana Maria", userId: null }] }, (s) => s.on("POST", "/players", () => respond(409, { error: "x", code: "ALREADY_IN_ROSTER" })));
    await user.click(await screen.findByRole("button", { name: "I'm in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Jose Silva is already in the list.");
    expect(screen.queryByTestId("thats-you")).not.toBeInTheDocument();
  });
});

describe("Options open right under the slot that was tapped", () => {
  it("puts the options in the grid itself, directly after the tapped slot, spanning the whole row (the row layout is checked in a real browser: jsdom has no layout)", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(5) });
    await user.click(await screen.findByRole("button", { name: "Options for Player 1" }));
    const grid = screen.getByTestId("lineup-slots");
    const row = await screen.findByTestId("slot-options-row");
    expect(row.parentElement).toBe(grid);
    expect(row.previousElementSibling).toBe(screen.getByRole("button", { name: "Options for Player 1" }));
    expect(cssFor(row)).toMatch(/grid-column:\s*1\s*\/\s*-1/);
    expect(cssFor(grid)).toMatch(/grid-auto-flow:\s*row dense/);
    // Not at the end of the grid, and only one set of options.
    expect(grid.lastElementChild).not.toBe(row);
    expect(screen.getAllByTestId("player-options")).toHaveLength(1);
  });

  it("keeps focus on Remove while open and gives it back to the slot on Escape", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(3) });
    await user.click(await screen.findByRole("button", { name: "Options for Player 2" }));
    expect(within(await screen.findByTestId("slot-options-row")).getByRole("button", { name: "Remove Player 2" })).toHaveFocus();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.getByRole("button", { name: "Options for Player 2" })).toHaveFocus());
    expect(screen.queryByTestId("slot-options-row")).not.toBeInTheDocument();
  });
});

describe("Other people joining and leaving are announced politely", () => {
  const announce = () => screen.getByTestId("roster-announcement");

  it("is a polite, atomic live region that is always there, so a screen reader has it before the news", async () => {
    renderPage({ players: rows(2) });
    await screen.findByTestId("lineup-slots");
    expect(announce()).toHaveAttribute("role", "status");
    expect(announce()).toHaveAttribute("aria-live", "polite");
    expect(announce()).toHaveAttribute("aria-atomic", "true");
    expect(announce()).toBeEmptyDOMElement();
  });

  it("says 'Ana M. joined' once the poll finds her — and says nothing about the first reading", async () => {
    renderPage({ players: rows(2) });
    await screen.findByTestId("lineup-slots");
    expect(announce()).toBeEmptyDOMElement();
    server.state.event.players = [...server.state.event.players, { id: "x", name: "Ana Maria", userId: "u-ana" }];
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(announce()).toHaveTextContent("Ana M. joined"), { timeout: 5000 });
  }, 10_000);

  it("batches several changes into one sentence, and says who left", async () => {
    renderPage({ players: [...rows(3), { id: "l", name: "Leo Reis", userId: null }] });
    await screen.findByTestId("lineup-slots");
    server.state.event.players = [...rows(3), { id: "a", name: "Ana Maria", userId: "u-a" }, { id: "b", name: "Beto Santos", userId: "u-b" }];
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(announce()).toHaveTextContent("Ana M. and Beto S. joined. Leo R. left"), { timeout: 5000 });
  }, 10_000);

  it("never announces what the viewer just did themselves", async () => {
    const user = userEvent.setup();
    renderPage({ players: rows(2) });
    await user.type(await openPanel(user), "Rui{Enter}");
    await screen.findByText("Added Rui ✓");
    await new Promise((r) => setTimeout(r, 3200));
    expect(announce()).toBeEmptyDOMElement();
  }, 10_000);
});

describe("Manage lineup — a visible way in for the organizer", () => {
  it("shows a small 'Manage lineup' link next to 'Who's in' for the owner, going to the lineup page", async () => {
    mockSession.data = OWNER;
    renderPage({ players: rows(3) });
    const link = await screen.findByRole("link", { name: "Manage lineup" });
    expect(link).toHaveAttribute("href", "/events/evt-1/lineup");
    const who = screen.getByRole("button", { name: "Who's in" });
    expect(who.parentElement).toBe(link.parentElement);
  });

  it("shows it to an event admin too", async () => {
    mockSession.data = { user: { id: "someone", name: "Admin" } };
    renderPage({ players: rows(3), isAdmin: true });
    expect(await screen.findByRole("link", { name: "Manage lineup" })).toBeInTheDocument();
  });

  it("does not show it to a player, or to a signed-out visitor", async () => {
    renderPage({ players: rows(3) });
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByRole("link", { name: "Manage lineup" })).not.toBeInTheDocument();
    cleanup();
    mockSession.data = null;
    renderPage({ players: rows(3) });
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByRole("link", { name: "Manage lineup" })).not.toBeInTheDocument();
  });

  it("is not shown when nobody is in yet: there is nothing to manage", async () => {
    mockSession.data = OWNER;
    renderPage({ players: [] });
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByRole("link", { name: "Manage lineup" })).not.toBeInTheDocument();
  });
});
