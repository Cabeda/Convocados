import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor, within, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import EventPage from "~/components/EventPage";
import { formatDateInTz } from "~/lib/timezones";
import { HOUR, WEEKLY, fakeServer, makeEvent, respond, type Row } from "./eventPageHarness";

const mockSession = { data: { user: { id: "u-1", name: "Jose Silva" } } as { user: { id: string; name: string } } | null, isPending: false, refetch: vi.fn() };
vi.mock("~/lib/auth.client", () => ({ useSession: () => mockSession, signOut: vi.fn() }));

const me: Row = { id: "me", name: "Jose Silva", userId: "u-1" };
const four: Row[] = [me, { id: "p1", name: "Ana Maria", userId: null }, { id: "p2", name: "Rui Costa", userId: null }, { id: "p3", name: "Beto Santos", userId: null }];
const teamResults = [
  { id: "t1", name: "Ninjas", members: [{ name: "Jose Silva", order: 0 }, { name: "Ana Maria", order: 1 }] },
  { id: "t2", name: "Gunas", members: [{ name: "Rui Costa", order: 0 }, { name: "Beto Santos", order: 1 }] },
];
const game = (over: Record<string, unknown> = {}) => ({ maxPlayers: 4, players: four, teamResults, ...over });
const asOwner = () => { mockSession.data = { user: { id: "owner-9", name: "Sam" } }; };

let server: ReturnType<typeof fakeServer>;
function renderPage(over: Record<string, unknown> = {}, setup?: (s: ReturnType<typeof fakeServer>) => void) {
  server = fakeServer(makeEvent(over));
  setup?.(server);
  server.install();
  return renderWithTheme(<EventPage eventId="evt-1" />);
}
/** The server keeps what it is sent, like PUT /teams and PUT /team-names do. */
function serverKeeps(s: ReturnType<typeof fakeServer>) {
  s.on("PUT", "/teams", (c) => {
    const matches = c.body!.matches as Array<{ team: string; players: Array<{ name: string; order: number }> }>;
    s.state.event.teamResults = matches.map((m, i) => ({ id: `t${i + 1}`, name: m.team, members: m.players.map((p) => ({ name: p.name, order: p.order })) }));
  });
  s.on("PUT", "/team-names", (c) => {
    s.state.event.teamOneName = c.body!.teamOneName; s.state.event.teamTwoName = c.body!.teamTwoName;
    s.state.event.teamResults = s.state.event.teamResults.map((tr: { name: string }, i: number) => ({ ...tr, name: i === 0 ? c.body!.teamOneName : c.body!.teamTwoName }));
  });
}
const column = (name: string) => screen.getByRole("group", { name });

beforeEach(() => {
  mockSession.data = { user: { id: "u-1", name: "Jose Silva" } };
  window.history.pushState({}, "", "/events/evt-1");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Teams — what the block says", () => {
  it("heads the teams with the day and shows two columns with the viewer's own team underlined and named", async () => {
    const dateTime = new Date(Date.now() + 5 * 24 * HOUR).toISOString();
    renderPage(game({ dateTime }));
    const day = formatDateInTz(new Date(dateTime), "en", "UTC", { weekday: "long" });
    expect(await screen.findByRole("heading", { level: 3, name: `Teams for ${day}` })).toBeInTheDocument();
    expect(column("Team 1")).toHaveAttribute("data-viewer-team", "true");
    expect(column("Team 2")).not.toHaveAttribute("data-viewer-team");
    expect(within(column("Team 1")).getByTestId("team-player-Jose Silva")).toHaveAttribute("data-you", "true");
    // A stock name is shown as "Team 1"; the stock name itself is not on the page.
    expect(screen.queryByText("Ninjas")).not.toBeInTheDocument();
  });

  it("keeps the names a group chose", async () => {
    renderPage(game({ teamOneName: "Lions", teamTwoName: "Gunas", teamResults: [{ ...teamResults[0], name: "Lions" }, teamResults[1]] }));
    expect(await screen.findByRole("group", { name: "Lions" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Team 2" })).toBeInTheDocument();
  });

  it("says 'today' on game day", async () => {
    const now = Date.now();
    const sameDay = (ms: number) => new Date(ms).toISOString().slice(0, 10) === new Date(now).toISOString().slice(0, 10);
    const dateTime = new Date(sameDay(now - 60_000) ? now - 60_000 : now + 60_000).toISOString();
    renderPage(game({ dateTime }));
    expect(await screen.findByRole("heading", { level: 3, name: "Teams for today" })).toBeInTheDocument();
  });

  it("says the teams were drawn early when the list is not full, and not when it is", async () => {
    renderPage(game({ maxPlayers: 5 }));
    expect(await screen.findByTestId("teams-drawn-early")).toHaveTextContent("Drawn early · 4 of 5 are in");
    cleanup();
    renderPage(game());
    await screen.findByTestId("team-columns");
    expect(screen.queryByTestId("teams-drawn-early")).not.toBeInTheDocument();
  });

  it("shows short names and keeps the whole name for a screen reader and a long press", async () => {
    renderPage(game());
    const col = await screen.findByRole("group", { name: "Team 2" });
    expect(within(col).getByText("Rui C.")).toBeInTheDocument();
    expect(within(col).getByText("Rui Costa")).toBeInTheDocument();
    expect(within(col).getByTestId("team-player-Rui Costa").querySelector("[title]")).toHaveAttribute("title", "Rui Costa");
  });

  it("tells two people with the same short name apart", async () => {
    const rows = [{ id: "a", name: "Ana Maria", userId: null }, { id: "b", name: "Ana Marta", userId: null }];
    renderPage({ maxPlayers: 2, players: rows, teamResults: [{ id: "t1", name: "Ninjas", members: [{ name: "Ana Maria", order: 0 }] }, { id: "t2", name: "Gunas", members: [{ name: "Ana Marta", order: 0 }] }] });
    await screen.findByTestId("team-columns");
    expect(screen.getAllByText("Ana Maria").length).toBeGreaterThan(0);
    expect(screen.queryByText("Ana M.")).not.toBeInTheDocument();
  });

  it("shows a rating beside a name only for a balanced game that does not hide it, with no 'Elo' on the page", async () => {
    const ratings = (s: ReturnType<typeof fakeServer>) => s.on("GET", "/ratings", () => ({ data: [{ name: "Rui Costa", rating: 1231.4 }] }));
    renderPage(game({ balanced: true, eloEnabled: true }), ratings);
    expect(await screen.findByRole("img", { name: "rating 1231" })).toHaveTextContent("1231");
    expect(document.body.textContent).not.toMatch(/elo/i);
    cleanup();
    renderPage(game({ balanced: true, eloEnabled: true, hideEloInTeams: true }), ratings);
    await screen.findByTestId("team-columns");
    expect(screen.queryByRole("img", { name: /rating/ })).not.toBeInTheDocument();
    cleanup();
    renderPage(game({ balanced: false }), ratings);
    await screen.findByTestId("team-columns");
    expect(screen.queryByRole("img", { name: /rating/ })).not.toBeInTheDocument();
  });

  it("shows a position only when positions are on", async () => {
    const withPos = four.map((p) => (p.name === "Rui Costa" ? { ...p, position: "GK" } : p));
    renderPage(game({ players: withPos, positionsEnabled: true }));
    expect(await within(await screen.findByRole("group", { name: "Team 2" })).findByText("Goalkeeper")).toBeInTheDocument();
    cleanup();
    renderPage(game({ players: withPos, positionsEnabled: false }));
    await screen.findByTestId("team-columns");
    expect(screen.queryByText("Goalkeeper")).not.toBeInTheDocument();
  });

  it("shows nothing for a game that has no teams, to a player", async () => {
    renderPage(game({ teamResults: [] }));
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByTestId("teams")).not.toBeInTheDocument();
  });
});

describe("Teams — changing them", () => {
  it("moves a person in one tap, saves it, and undoes it", async () => {
    const user = userEvent.setup();
    renderPage(game(), serverKeeps);
    await user.click(await screen.findByRole("button", { name: "Move Ana Maria to Team 2" }));
    await waitFor(() => expect(server.sent("PUT", "/teams")).toHaveLength(1));
    const moved = server.sent("PUT", "/teams")[0].body!.matches as Array<{ team: string; players: Array<{ name: string }> }>;
    expect(moved[1].players.map((p) => p.name)).toEqual(["Rui Costa", "Beto Santos", "Ana Maria"]);
    expect(within(column("Team 2")).getByTestId("team-player-Ana Maria")).toBeInTheDocument();
    expect(await screen.findByText("Ana M. moved to Team 2")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Undo" }));
    await waitFor(() => expect(server.sent("PUT", "/teams")).toHaveLength(2));
    const back = server.sent("PUT", "/teams")[1].body!.matches as Array<{ players: Array<{ name: string }> }>;
    expect(back[0].players.map((p) => p.name)).toEqual(["Jose Silva", "Ana Maria"]);
  });

  it("offers no move to someone who is not allowed to change the teams", async () => {
    mockSession.data = { user: { id: "u-stranger", name: "Stranger" } };
    renderPage(game());
    await screen.findByTestId("team-columns");
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
    cleanup();
    mockSession.data = null;
    renderPage(game());
    await screen.findByTestId("team-columns");
    expect(screen.queryByRole("button", { name: /^Move / })).not.toBeInTheDocument();
  });

  it("says so when a move cannot be saved, and the page goes back to what the server has", async () => {
    const user = userEvent.setup();
    renderPage(game(), (s) => s.on("PUT", "/teams", () => respond(500, { error: "boom" })));
    await user.click(await screen.findByRole("button", { name: "Move Ana Maria to Team 2" }));
    expect(await screen.findByText(/boom|Couldn't save the teams/)).toBeInTheDocument();
    await waitFor(() => expect(within(column("Team 1")).getByTestId("team-player-Ana Maria")).toBeInTheDocument());
  });

  it("offers dragging only with a mouse or trackpad", async () => {
    renderPage(game());
    await screen.findByTestId("team-columns");
    expect(screen.queryByTestId("team-player-handle-Ana Maria")).not.toBeInTheDocument();
  });

  it("switches to the pitch and back to the list with one text button", async () => {
    const user = userEvent.setup();
    renderPage(game());
    await user.click(await screen.findByRole("button", { name: "Pitch view" }));
    expect(await screen.findByTestId("team-field")).toBeInTheDocument();
    expect(screen.queryByTestId("team-columns")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "List" }));
    expect(await screen.findByTestId("team-columns")).toBeInTheDocument();
  });
});

describe("Teams — renaming", () => {
  it("lets the organizer rename a team inline, announces it, and returns focus to the pencil", async () => {
    const user = userEvent.setup();
    asOwner();
    renderPage(game(), serverKeeps);
    await user.click(await screen.findByRole("button", { name: "Rename Team 1" }));
    const field = screen.getByRole("textbox", { name: "Rename Team 1" });
    expect(field).toHaveAttribute("maxlength", "50");
    await user.clear(field);
    await user.type(field, "Lions{Enter}");
    await waitFor(() => expect(server.sent("PUT", "/team-names")).toHaveLength(1));
    expect(server.sent("PUT", "/team-names")[0].body).toEqual({ teamOneName: "Lions", teamTwoName: "Gunas" });
    expect(await screen.findByRole("group", { name: "Lions" })).toBeInTheDocument();
    expect(screen.getByTestId("teams-announcement")).toHaveTextContent("Team renamed to Lions");
    await waitFor(() => expect(screen.getByRole("button", { name: "Rename Lions" })).toHaveFocus());
  });

  it("puts the old name back and says so when the server refuses", async () => {
    const user = userEvent.setup();
    asOwner();
    renderPage(game(), (s) => s.on("PUT", "/team-names", () => respond(500, {})));
    await user.click(await screen.findByRole("button", { name: "Rename Team 1" }));
    await user.type(screen.getByRole("textbox", { name: "Rename Team 1" }), "{Control>}a{/Control}Lions{Enter}");
    expect(await screen.findByText(/Couldn't rename the team|Something went wrong|went wrong/i)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("group", { name: "Team 1" })).toBeInTheDocument());
  });

  it("is the organizer's: a player who may move people may not rename", async () => {
    renderPage(game());
    await screen.findByRole("button", { name: "Move Ana Maria to Team 2" });
    expect(screen.queryByRole("button", { name: /^Rename/ })).not.toBeInTheDocument();
  });
});

describe("Teams — drawing", () => {
  it("asks in plain words before drawing from a short list, then draws and says the teams are ready", async () => {
    const user = userEvent.setup();
    asOwner();
    renderPage(game({ teamResults: [], players: four.slice(0, 3) }), serverDrawsSetup);
    await user.click(await screen.findByRole("button", { name: "Draw teams now" }));
    const dialog = await screen.findByRole("dialog", { name: "Draw teams now?" });
    expect(within(dialog).getByText("Not everyone is in yet. Draw teams with the 3 who are?")).toBeInTheDocument();
    expect(server.sent("POST", "/randomize")).toHaveLength(0);
    await user.click(within(dialog).getByRole("button", { name: "Draw teams" }));
    await waitFor(() => expect(server.sent("POST", "/randomize")).toHaveLength(1));
    expect(await screen.findByRole("heading", { level: 3, name: /^Teams for / })).toBeInTheDocument();
    expect(screen.getByTestId("teams-announcement")).toHaveTextContent("Teams are ready");
  });

  it("draws at once when the list is full, and offers 'draw again' with its own question", async () => {
    const user = userEvent.setup();
    asOwner();
    renderPage(game({ teamResults: [] }), serverDrawsSetup);
    await user.click(await screen.findByRole("button", { name: "Draw teams now" }));
    await waitFor(() => expect(server.sent("POST", "/randomize")).toHaveLength(1));
    await user.click(await screen.findByRole("button", { name: "Draw again" }));
    const dialog = await screen.findByRole("dialog", { name: "Draw again?" });
    expect(within(dialog).getByText("The teams you see now will be replaced.")).toBeInTheDocument();
    expect(server.sent("POST", "/randomize")).toHaveLength(1);
    await user.click(within(dialog).getByRole("button", { name: "Draw again" }));
    await waitFor(() => expect(server.sent("POST", "/randomize")).toHaveLength(2));
  });

  it("lets a game that keeps ratings choose even teams or random, starting from what the game does", async () => {
    const user = userEvent.setup();
    asOwner();
    renderPage(game({ balanced: true, eloEnabled: true, players: four.slice(0, 3), teamResults: [] }), serverDrawsSetup);
    await user.click(await screen.findByRole("button", { name: "Draw teams now" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("radio", { name: "Even teams, using past results" })).toBeChecked();
    await user.click(within(dialog).getByRole("radio", { name: "Random" }));
    await user.click(within(dialog).getByRole("button", { name: "Draw teams" }));
    await waitFor(() => expect(server.sent("POST", "/randomize")).toHaveLength(1));
    expect(server.sent("POST", "/randomize")[0].url).not.toContain("balanced=true");
  });

  it("is shut with the reason shown below two people", async () => {
    asOwner();
    renderPage(game({ teamResults: [], players: four.slice(0, 1) }));
    const button = await screen.findByRole("button", { name: "Draw teams now" });
    expect(button).toBeDisabled();
    expect(button).toHaveAccessibleDescription("Add at least 2 players to draw teams.");
    expect(screen.getByTestId("draw-reason")).toBeVisible();
  });

  it("is not offered to a player, to a signed-out visitor, or after a weekly game has ended", async () => {
    renderPage(game({ teamResults: [], players: four.slice(0, 3) }));
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByRole("button", { name: /Draw/ })).not.toBeInTheDocument();
    cleanup();
    mockSession.data = null;
    renderPage(game({ teamResults: [], players: four.slice(0, 3) }));
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByRole("button", { name: /Draw/ })).not.toBeInTheDocument();
    cleanup();
    asOwner();
    renderPage({ isRecurring: true, recurrenceRule: WEEKLY, dateTime: new Date(Date.now() - 3 * HOUR).toISOString(), players: four, teamResults });
    await screen.findByText("Sign-ups open in a moment");
    expect(screen.queryByRole("button", { name: /Draw/ })).not.toBeInTheDocument();
    expect(screen.queryByTestId("teams")).not.toBeInTheDocument();
  });
});

function serverDrawsSetup(s: ReturnType<typeof fakeServer>) {
  s.on("POST", "/randomize", () => { s.state.event.teamResults = teamResults; return { ok: true }; });
}

describe("Teams — appearing", () => {
  it("does not unfold or announce teams that were there when the page opened", async () => {
    renderPage(game());
    await screen.findByTestId("team-columns");
    expect(screen.getByTestId("teams")).not.toHaveAttribute("data-reveal");
    expect(screen.getByTestId("teams-announcement")).toBeEmptyDOMElement();
  });

  it("unfolds and announces them when the last place fills while the page is open, then settles", async () => {
    renderPage(game({ players: four.slice(0, 3), teamResults: [] }));
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByTestId("teams")).not.toBeInTheDocument();
    // Someone else takes the last place: the server fills the list and draws.
    server.state.event.players = four;
    server.state.event.teamResults = teamResults;
    fireEvent(window, new Event("focus"));
    const block = await screen.findByTestId("teams");
    expect(block).toHaveAttribute("data-reveal", "true");
    expect(screen.getByTestId("teams-announcement")).toHaveTextContent("Teams are ready");
    await waitFor(() => expect(screen.getByTestId("teams")).not.toHaveAttribute("data-reveal"), { timeout: 2000 });
    // Said once and kept: it is not read out again.
    expect(screen.getByTestId("teams-announcement")).toHaveTextContent("Teams are ready");
  });
});

describe("Teams — what is at stake", () => {
  const scenario = (outcome: string, pts: number) => ({
    outcome,
    players: [{ name: "Jose Silva", side: "teamOne", crewId: "c1", crewName: "Sharks", contribution: pts, rpDelta: 12, rankBefore: 1, rankAfter: 1, tierBefore: 1, tierAfter: 1, provisional: false, positionBefore: 3, positionAfter: 2, passed: 1 }],
    crews: [{ crewId: "c1", name: "Sharks", roundScore: pts, membersInLineup: 1, positionBefore: 2, positionAfter: 1, passed: 1 }],
  });
  const active = (s: ReturnType<typeof fakeServer>) => s.on("POST", "/stakes-preview", () => ({
    active: true,
    preview: {
      seasonId: "s1", seasonName: "Autumn", rankEnabled: true, roundAvailable: true, roundsCounted: 2, viewerName: "Jose Silva",
      lineup: [{ name: "Jose Silva", side: "teamOne", crewId: "c1", crewName: "Sharks", participant: true }],
      scenarios: [scenario("teamOne", 3), scenario("draw", 1), scenario("teamTwo", 0)],
    },
  }));

  it("is one quiet button, only when there is a season, with no toggle or table on the page itself", async () => {
    renderPage(game(), active);
    expect(await screen.findByRole("button", { name: "What's at stake" })).toBeInTheDocument();
    expect(screen.queryByTestId("stakes-preview")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /win$/ })).not.toBeInTheDocument();
    expect(await within(column("Team 1")).findByText("Sharks")).toBeInTheDocument();
    cleanup();
    renderPage(game(), (s) => s.on("POST", "/stakes-preview", () => ({ active: false })));
    await screen.findByTestId("team-columns");
    await new Promise((r) => setTimeout(r, 400));
    expect(screen.queryByRole("button", { name: "What's at stake" })).not.toBeInTheDocument();
  });

  it("opens a sheet that traps focus, answers to Escape, and hands focus back to the button", async () => {
    const user = userEvent.setup();
    renderPage(game(), active);
    const opener = await screen.findByRole("button", { name: "What's at stake" });
    await user.click(opener);
    const dialog = await screen.findByRole("dialog", { name: "What's at stake" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
    expect(within(dialog).getByTestId("stakes-preview")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Draw" }));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });
});
