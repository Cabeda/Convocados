import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, cleanup, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import EventPage from "~/components/EventPage";
import { formatDateInTz } from "~/lib/timezones";
import { HOUR, WEEKLY, fakeServer, makeEvent, respond } from "./eventPageHarness";

const mockSession = { data: { user: { id: "u-1", name: "Jose Silva" } } as { user: { id: string; name: string } } | null, isPending: false, refetch: vi.fn() };
vi.mock("~/lib/auth.client", () => ({ useSession: () => mockSession, signOut: vi.fn() }));

const endedAt = new Date(Date.now() - 3 * HOUR).toISOString();
const oneOff = (over: Record<string, unknown> = {}) => makeEvent({ dateTime: endedAt, isRecurring: false, recurrenceRule: null, ...over });
const asOwner = () => { mockSession.data = { user: { id: "owner-9", name: "Sam" } }; };

let server: ReturnType<typeof fakeServer>;
function renderPage(event: Record<string, unknown>, setup?: (s: ReturnType<typeof fakeServer>) => void) {
  server = fakeServer(event);
  setup?.(server);
  server.install();
  return renderWithTheme(<EventPage eventId="evt-1" />);
}
/** The server keeps the new rule, as PUT /recurrence does. */
const serverKeepsRule = (s: ReturnType<typeof fakeServer>) =>
  s.on("PUT", "/recurrence", () => { s.state.event.isRecurring = true; s.state.event.recurrenceRule = WEEKLY; return { isRecurring: true, recurrenceRule: WEEKLY }; });

beforeEach(() => {
  mockSession.data = { user: { id: "u-1", name: "Jose Silva" } };
  window.history.pushState({}, "", "/events/evt-1");
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("Play again — a one-off game that has ended", () => {
  it("gives a manager two ways on: make it weekly (the main one) or plan another", async () => {
    asOwner();
    renderPage(oneOff());
    expect(await screen.findByRole("heading", { level: 2, name: "Play again?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Make it weekly" })).toBeEnabled();
    expect(screen.getByRole("link", { name: "Plan another game" })).toHaveAttribute("href", "/");
    // Not the old chip and not an empty next game.
    expect(screen.queryByText("Weekly")).not.toBeInTheDocument();
    expect(screen.queryByTestId("lineup-slots")).not.toBeInTheDocument();
  });

  it("tells everyone else who to ask, with no buttons", async () => {
    renderPage(oneOff());
    expect(await screen.findByText("Ask Sam to plan the next one.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make it weekly" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Plan another game" })).not.toBeInTheDocument();
    cleanup();
    mockSession.data = null;
    renderPage(oneOff({ ownerName: null }));
    expect(await screen.findByText("Ask the organizer to plan the next one.")).toBeInTheDocument();
  });

  it("is not there for a game that repeats, for a game still to come, or for a cancelled one", async () => {
    asOwner();
    renderPage(oneOff({ isRecurring: true, recurrenceRule: WEEKLY }));
    await screen.findByText("Sign-ups open in a moment");
    expect(screen.queryByRole("heading", { name: "Play again?" })).not.toBeInTheDocument();
    cleanup();
    renderPage(oneOff({ dateTime: new Date(Date.now() + 2 * HOUR).toISOString() }));
    await screen.findByTestId("lineup-slots");
    expect(screen.queryByRole("heading", { name: "Play again?" })).not.toBeInTheDocument();
    cleanup();
    renderPage(oneOff({ gameStatus: "cancelled" }));
    await screen.findByRole("heading", { level: 2, name: "This game was cancelled" });
    expect(screen.queryByRole("heading", { name: "Play again?" })).not.toBeInTheDocument();
  });

  it("makes it weekly: the next game shows at once, a toast says 'Now every …', focus lands on the next game, and the rule is sent once", async () => {
    const user = userEvent.setup();
    asOwner();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    renderPage(oneOff(), (s) => {
      s.on("PUT", "/recurrence", async () => { await gate; s.state.event.isRecurring = true; s.state.event.recurrenceRule = WEEKLY; return { isRecurring: true }; });
    });
    const button = await screen.findByRole("button", { name: "Make it weekly" });
    await user.click(button);
    // Optimistic: the next game is already on the page while the server answers; a second tap cannot send a second request.
    expect(await screen.findByText("Sign-ups open in a moment")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Play again?" })).not.toBeInTheDocument();
    release();
    const day = formatDateInTz(new Date(endedAt), "en", "UTC", { weekday: "long" });
    expect(await screen.findByText(`Now every ${day}`)).toBeInTheDocument();
    expect(server.sent("PUT", "/recurrence")).toHaveLength(1);
    expect(server.sent("PUT", "/recurrence")[0].body).toEqual({ isRecurring: true, recurrenceFreq: "weekly", recurrenceInterval: 1 });
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Next game" })).toHaveFocus());
  });

  it("puts the page back and says what happened when the server refuses", async () => {
    const user = userEvent.setup();
    asOwner();
    renderPage(oneOff(), (s) => s.on("PUT", "/recurrence", () => respond(500, { error: "nope" })));
    await user.click(await screen.findByRole("button", { name: "Make it weekly" }));
    expect(await screen.findByText("Couldn't make it weekly. Try again.")).toBeInTheDocument();
    const again = await screen.findByRole("button", { name: "Make it weekly" });
    expect(again).toBeEnabled();
    await waitFor(() => expect(again).toHaveFocus());
    expect(screen.queryByText("Sign-ups open in a moment")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Now every/)).not.toBeInTheDocument();
    // And it can be tried again.
    server.on("PUT", "/recurrence", () => { server.state.event.isRecurring = true; server.state.event.recurrenceRule = WEEKLY; return {}; });
    await user.click(again);
    expect(await screen.findByText("Sign-ups open in a moment")).toBeInTheDocument();
  });

  it("keeps the recap of the game that ended: it never hides for a one-off", async () => {
    asOwner();
    renderPage(oneOff({ hasLastGame: true }), serverKeepsRule);
    expect(await screen.findByRole("heading", { level: 2, name: "Play again?" })).toBeInTheDocument();
    expect(within(document.body).queryByTestId("recurrence-prompt")).not.toBeInTheDocument();
  });
});
