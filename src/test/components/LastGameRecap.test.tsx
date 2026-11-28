// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { LastGameRecap, type LastGameRecapProps } from "~/components/event/story/LastGameRecap";
import type { PostGameStatus } from "~/components/event/story/postGameStatus";
import type { RecapTask } from "~/lib/eventStory";
import { cssFor } from "../emotionCss";

const headers = new Headers({ "Content-Type": "application/json" });
const calls: Array<{ url: string; method: string; body?: unknown }> = [];

function stubFetch(handler: (url: string, method: string) => unknown = () => ({})) {
  calls.length = 0;
  vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const out = handler(String(url), method);
    if (out instanceof Error) return Promise.resolve({ ok: false, status: 500, headers, json: async () => ({ error: "boom" }) });
    return Promise.resolve({ ok: true, status: 200, headers, json: async () => out });
  }));
}

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const status: PostGameStatus = {
  gameEnded: true, hasScore: true, hasCost: true, allPaid: false, allComplete: false, isParticipant: true,
  isPlayer: true, latestHistoryId: "h1", costCurrency: "EUR", costAmount: 50, hasPendingPastPayments: false,
  mvpEnabled: true, mvpComplete: false, bannerMvpComplete: false, myMvpComplete: false,
  scoreOne: 5, scoreTwo: 3, teamOneName: "Shadow Foxes", teamTwoName: "Blue Lions",
  gamePayments: [
    { eventPlayerId: "ep-ana", name: "Ana", amount: 5, status: "pending", isPayer: false },
    { eventPlayerId: "ep-maria", name: "Maria", amount: 5, status: "paid", isPayer: true },
  ],
  gameConfig: { gameId: "g1", mode: "tracked", payerName: "Maria", payerIsPlayer: true },
  viewerTeam: 0, lastGamePlayerCount: 12,
};
const missing = { ...status, hasScore: false, scoreOne: null, scoreTwo: null };

const mvpTask: RecapTask = { kind: "mvp", needsYou: true };
const payTask: RecapTask = { kind: "pay", needsYou: true, amount: 5, payerName: "Maria", eventPlayerId: "ep-ana", hasPaymentDetails: false };

function props(over: Partial<LastGameRecapProps> = {}): LastGameRecapProps {
  return {
    eventId: "e1", status, expanded: true, canCollapse: false, onToggle: vi.fn(), dateLabel: "Wed 4 Mar",
    role: "played", viewerName: "Ana", onChanged: vi.fn(), summary: "You won · +143 points this season",
    tasks: [mvpTask, payTask], ...over,
  };
}
const show = (over?: Partial<LastGameRecapProps>) => renderWithTheme(<LastGameRecap {...props(over)} />);

describe("LastGameRecap — full card", () => {
  it("shows the date, both teams, the score and one plain sentence", () => {
    show();
    expect(screen.getByText("Last game · Wed 4 Mar")).toBeInTheDocument();
    expect(screen.getByText("Shadow Foxes")).toBeInTheDocument();
    expect(screen.getByText("Blue Lions")).toBeInTheDocument();
    expect(screen.getByTestId("score-one")).toHaveTextContent("5");
    expect(screen.getByTestId("score-two")).toHaveTextContent("3");
    expect(screen.getByText("You won · +143 points this season")).toBeInTheDocument();
  });

  it("uses no ranking jargon anywhere on the card", () => {
    const { container } = show();
    expect(container.textContent).not.toMatch(/\bRP\b|\bTier\b|\bCrew\b|Provisional|Wrap it up/);
  });

  it("lists what is left, in order, with named actions — the collector said once, as an action", () => {
    show();
    const rows = screen.getAllByTestId("recap-task");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Vote for MVP")).toBeInTheDocument();
    expect(within(rows[1]).getByText("You owe €5")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Tell Maria you've sent it")).toBeInTheDocument();
    expect(within(rows[1]).getByRole("button", { name: "I've paid" })).toBeInTheDocument();
    expect(screen.queryByText("Maria is collecting")).toBeNull();
  });

  it("puts the amber dot only on rows that need the viewer", () => {
    show({ tasks: [payTask, { kind: "collect", needsYou: false, paidCount: 2, totalCount: 5, sentCount: 0 }] });
    const rows = screen.getAllByTestId("recap-task");
    expect(within(rows[0]).getByTestId("needs-you-dot")).toBeInTheDocument();
    expect(within(rows[1]).queryByTestId("needs-you-dot")).toBeNull();
  });

  it("links to the game, payments and ranking, each tile saying what it holds", () => {
    show();
    const game = screen.getByRole("link", { name: /Game details/ });
    expect(game).toHaveAttribute("href", "/events/e1/history");
    expect(game).toHaveTextContent("12 played");
    expect(screen.getByRole("link", { name: /Payments/ })).toHaveAttribute("href", "/events/e1/payments");
    expect(screen.getByRole("link", { name: /Payments/ })).toHaveTextContent("1 of 2 paid");
    expect(screen.getByRole("link", { name: /Ranking/ })).toHaveAttribute("href", "/events/e1/rankings");
    expect(screen.queryByRole("link", { name: /Lineup/ })).toBeNull();
  });

  it("never writes paid counts as 9/16", () => {
    const { container } = show();
    expect(container.textContent).not.toMatch(/\d+\/\d+/);
  });

  it("gives every link tile the same minimum height and a sub line", () => {
    show();
    for (const name of [/Game details/, /Payments/, /Ranking/]) {
      expect(cssFor(screen.getByRole("link", { name }))).toMatch(/min-height:\s*72px/);
    }
  });

  it("hides the payments link when no cost exists", () => {
    show({ status: { ...status, hasCost: false, gamePayments: null }, tasks: [] });
    expect(screen.queryByRole("link", { name: /Payments/ })).toBeNull();
  });

  it("says all done to a player with nothing left and the score in", () => {
    show({ tasks: [] });
    expect(screen.getByText("All done")).toBeInTheDocument();
  });

  it("does not say all done to an admin who did not play and has nothing assigned", () => {
    show({ tasks: [], role: "absent" });
    expect(screen.queryByText("All done")).toBeNull();
  });

  it("asks a signed-out viewer to sign in instead of listing tasks", () => {
    show({ role: "signedOut", viewerName: null, tasks: [] });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Sign in to vote and see what you owe")).toBeInTheDocument();
    expect(screen.queryByTestId("recap-task")).toBeNull();
    expect(screen.queryByText("All done")).toBeNull();
  });

  it("says a missing score once: dashes and one sentence for someone who cannot add it", () => {
    show({ status: missing, summary: "Score not added yet", tasks: [], role: "absent" });
    expect(screen.getByTestId("score-one")).toHaveTextContent("–");
    expect(screen.getAllByText("Score not added yet")).toHaveLength(1);
    expect(screen.queryByText(/Someone who played/)).toBeNull();
    expect(screen.queryByText(/Nobody has added it yet/)).toBeNull();
  });

  it("lets the add-score row carry the sentence for someone who can add it", () => {
    show({ status: missing, summary: "Score not added yet", tasks: [{ kind: "addScore", needsYou: true, inline: true }] });
    expect(screen.getByText("Nobody has added it yet. Add it so everyone sees it.")).toBeInTheDocument();
    expect(screen.queryByText("Score not added yet")).toBeNull();
  });
});

describe("LastGameRecap — MVP result", () => {
  it("shows who won MVP, with a trophy and a spoken label, once voting has closed", async () => {
    stubFetch(() => ({ isVotingOpen: false, mvp: [{ playerId: "p1", playerName: "Rui", voteCount: 4 }] }));
    show({ tasks: [] });
    const line = await screen.findByTestId("recap-mvp-result");
    expect(line).toHaveTextContent("MVP: Rui");
    expect(line).toHaveAttribute("aria-label", "Most valuable player: Rui");
    expect(line.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
  });

  it("names everybody on a tie", async () => {
    stubFetch(() => ({ isVotingOpen: false, mvp: [{ playerName: "Rui" }, { playerName: "Bia" }] }));
    show({ tasks: [] });
    expect(await screen.findByTestId("recap-mvp-result")).toHaveTextContent("MVP: Rui, Bia");
  });

  it("says nothing while voting is still open, or when nobody voted", async () => {
    stubFetch(() => ({ isVotingOpen: true, mvp: [{ playerName: "Rui" }] }));
    show({ tasks: [] });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("recap-mvp-result")).toBeNull();
    cleanup();
    stubFetch(() => ({ isVotingOpen: false, mvp: null }));
    show({ tasks: [] });
    await waitFor(() => expect(calls.length).toBeGreaterThan(0));
    expect(screen.queryByTestId("recap-mvp-result")).toBeNull();
  });

  it("asks nothing of the server while the card is a strip, or when MVP is off", async () => {
    stubFetch(() => ({ isVotingOpen: false, mvp: [{ playerName: "Rui" }] }));
    show({ expanded: false, tasks: [] });
    cleanup();
    show({ status: { ...status, mvpEnabled: false }, tasks: [] });
    await new Promise((r) => setTimeout(r, 10));
    expect(calls).toHaveLength(0);
  });
});

describe("LastGameRecap — strip and toggle", () => {
  it("collapses to a one-line strip: the result, the date and the sentence, with the details hidden from assistive tech", () => {
    show({ expanded: false });
    const toggle = screen.getByRole("button", { name: "Show details of the last game" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "I've paid" })).toBeNull(); // inert + aria-hidden, still in the DOM so it can animate open
    expect(screen.getByTestId("score-one")).toHaveTextContent("5"); // the same element, resized
    expect(screen.getByTestId("recap-header-label")).toHaveTextContent("Last game · Wed 4 Mar · You won · +143 points this season");
  });

  it("opens from the strip with the toggle, and by tapping the scoreboard", () => {
    const onToggle = vi.fn();
    show({ expanded: false, onToggle });
    fireEvent.click(screen.getByRole("button", { name: "Show details of the last game" }));
    fireEvent.click(screen.getByTestId("recap-scoreboard"));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it("offers Hide only when the viewer has nothing left to do", () => {
    show({ canCollapse: false });
    expect(screen.queryByRole("button", { name: "Hide details of the last game" })).toBeNull();
    cleanup();
    show({ canCollapse: true, tasks: [] });
    expect(screen.getByRole("button", { name: "Hide details of the last game" })).toHaveAttribute("aria-expanded", "true");
  });

  it("does not collapse by tapping the scoreboard while expanded", () => {
    const onToggle = vi.fn();
    show({ expanded: true, canCollapse: true, onToggle });
    fireEvent.click(screen.getByTestId("recap-scoreboard"));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("switches its motion off for people who ask for less", () => {
    show({ expanded: false });
    const details = document.getElementById("recap-details-e1")!;
    expect(cssFor(details)).toMatch(/prefers-reduced-motion: reduce[\s\S]*transition:\s*none/);
  });
});

describe("LastGameRecap — actions", () => {
  it("I've paid hides the row at once, says what happened and refreshes", async () => {
    stubFetch();
    const onChanged = vi.fn();
    show({ onChanged });
    fireEvent.click(screen.getByRole("button", { name: "I've paid" }));
    expect(screen.getByText("You said you paid €5 · waiting for Maria")).toBeInTheDocument();
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: "/api/events/e1/payments/settlement/self-report",
      body: { gameId: "g1", eventPlayerId: "ep-ana" },
    });
  });

  it("I've paid failing puts the row back and says what happened", async () => {
    stubFetch(() => new Error("x"));
    const onRollback = vi.fn();
    show({ onRollback, onOptimistic: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "I've paid" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't send that. Try again."));
    expect(onRollback).toHaveBeenCalledWith("paidIds");
    expect(screen.queryByText("You said you paid €5 · waiting for Maria")).toBeNull();
  });

  it("offers How to pay only when the collector has details to show", () => {
    show();
    expect(screen.queryByRole("link", { name: "How to pay" })).toBeNull();
    cleanup();
    show({ tasks: [{ ...payTask, hasPaymentDetails: true }] });
    expect(screen.getByRole("link", { name: "How to pay" })).toHaveAttribute("href", "/events/e1/payments");
  });

  it("the collector's row says how many paid, with no money sum, and links to who owes", () => {
    show({ role: "played", tasks: [{ kind: "collect", needsYou: false, paidCount: 2, totalCount: 5, sentCount: 0 }] });
    expect(screen.getByText("You're collecting")).toBeInTheDocument();
    expect(screen.getByText("2 of 5 paid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See who owes" })).toHaveAttribute("href", "/events/e1/payments");
  });

  it("tells the collector how many are waiting for their OK", () => {
    show({ tasks: [{ kind: "collect", needsYou: true, paidCount: 2, totalCount: 5, sentCount: 1 }] });
    expect(screen.getByText("2 of 5 paid · 1 waiting for you")).toBeInTheDocument();
    expect(screen.getByTestId("needs-you-dot")).toBeInTheDocument();
  });

  it("opens the MVP picker inline from the Vote toggle", async () => {
    stubFetch(() => ({ isVotingOpen: true, hasVoted: false, participants: [{ id: "p1", name: "Rui", voteCount: 0 }, { id: "p2", name: "Ana", voteCount: 0 }] }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Vote" }));
    expect(await screen.findByRole("radio", { name: "Rui" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Ana" })).toBeNull(); // cannot vote for yourself
  });

  it("does not offer the viewer's linked roster name either", async () => {
    stubFetch(() => ({ participants: [{ id: "p1", name: "Rui", voteCount: 0 }, { id: "p2", name: "Ana B", voteCount: 0 }] }));
    show({ viewerName: "anab99", viewerNames: ["anab99", "Ana B"] });
    fireEvent.click(screen.getByRole("button", { name: "Vote" }));
    expect(await screen.findByRole("radio", { name: "Rui" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Ana B" })).toBeNull();
  });

  it("a vote hides the row at once and a refused vote brings the picker back with the pick and an error", async () => {
    let fail = true;
    stubFetch((_u, method) => (method === "POST" && fail ? new Error("x") : { participants: [{ id: "p1", name: "Rui", voteCount: 0 }, { id: "p2", name: "Bia", voteCount: 0 }] }));
    const onRollback = vi.fn();
    show({ tasks: [mvpTask], onRollback, onOptimistic: vi.fn() });
    fireEvent.click(screen.getByRole("button", { name: "Vote" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Bia" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm vote" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save your vote. Try again.");
    expect(onRollback).toHaveBeenCalledWith("voted");
    expect(await screen.findByRole("radio", { name: "Bia" })).toBeChecked();
    fail = false;
  });

  it("add-score opens the steppers in place of the scoreboard when a history row exists", () => {
    show({ status: missing, tasks: [{ kind: "addScore", needsYou: true, inline: true }], summary: "Score not added yet" });
    fireEvent.click(screen.getByRole("button", { name: "Add score" }));
    expect(screen.getByRole("button", { name: "One more for Shadow Foxes" })).toBeInTheDocument();
    // team names and numbers are said once: the steppers ARE the scoreboard now
    expect(screen.getAllByText("Shadow Foxes")).toHaveLength(1);
    expect(screen.queryByTestId("score-one")).toBeNull();
    expect(screen.getByRole("button", { name: "Add score" })).toHaveAttribute("aria-expanded", "true");
  });

  it("saving the score shows it at once, without asking for it again, and rolls back on error", async () => {
    stubFetch(() => new Error("x"));
    const onOptimistic = vi.fn();
    const onRollback = vi.fn();
    show({ status: missing, tasks: [{ kind: "addScore", needsYou: true, inline: true }], autoOpenScore: true, onOptimistic, onRollback });
    fireEvent.click(screen.getByRole("button", { name: "One more for Blue Lions" }));
    fireEvent.click(screen.getByRole("button", { name: "Save score" }));
    expect(onOptimistic).toHaveBeenCalledWith({ score: [0, 1] });
    expect(screen.getByText("Score saved")).toBeInTheDocument();
    await waitFor(() => expect(onRollback).toHaveBeenCalledWith("score"));
    expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't save the score. Check your connection and try again.");
    expect(screen.queryByText("Score saved")).toBeNull();
    // the numbers the viewer typed are still there
    expect(screen.getAllByText("1")).toHaveLength(1);
  });

  it("add-score falls back to History when the score cannot be saved in place", () => {
    show({ status: missing, tasks: [{ kind: "addScore", needsYou: true, inline: false }], summary: "Score not added yet" });
    expect(screen.getByRole("link", { name: "Open history" })).toHaveAttribute("href", "/events/e1/history");
  });

  it("opens the steppers straight away for the add-score deep link, with focus on the first one", () => {
    show({ status: missing, tasks: [{ kind: "addScore", needsYou: true, inline: true }], autoOpenScore: true });
    expect(screen.getByRole("button", { name: "One less for Shadow Foxes" })).toHaveFocus();
  });

  it("buzzes once for a finished task, and does not break where vibration is missing", async () => {
    const setVibrate = (value: unknown) => Object.defineProperty(navigator, "vibrate", { configurable: true, writable: true, value });
    stubFetch();
    const vibrate = vi.fn();
    setVibrate(vibrate);
    show();
    fireEvent.click(screen.getByRole("button", { name: "I've paid" }));
    await waitFor(() => expect(vibrate).toHaveBeenCalledTimes(1));
    expect(vibrate).toHaveBeenCalledWith(10);
    cleanup();
    setVibrate(undefined);
    show();
    expect(() => fireEvent.click(screen.getByRole("button", { name: "I've paid" }))).not.toThrow();
    cleanup();
    setVibrate(() => { throw new Error("blocked"); });
    show();
    expect(() => fireEvent.click(screen.getByRole("button", { name: "I've paid" }))).not.toThrow();
    delete navigator.vibrate;
  });
});

describe("LastGameRecap — one press and focus style for every tappable", () => {
  it("gives every button and link on the card the focus ring and the press feedback", () => {
    show({ role: "played", tasks: [mvpTask, { ...payTask, hasPaymentDetails: true }, { kind: "collect", needsYou: false, paidCount: 1, totalCount: 2, sentCount: 0 }] });
    const tappables = [...document.querySelectorAll<HTMLElement>("a[href], button")].filter((el) => !el.closest("[inert]"));
    expect(tappables.length).toBeGreaterThanOrEqual(6);
    for (const el of tappables) {
      const css = cssFor(el);
      expect(css, el.textContent ?? el.getAttribute("aria-label") ?? "").toMatch(/:focus-visible/);
    }
    for (const el of document.querySelectorAll<HTMLElement>("button, a[href].MuiButton-root")) {
      if (el.closest("[inert]")) continue;
      expect(cssFor(el)).toMatch(/scale\(0?\.98\)/);
    }
  });

  it("makes the main actions 48px or taller", () => {
    show();
    for (const name of ["I've paid", "Vote"]) {
      expect(cssFor(screen.getByRole("button", { name }))).toMatch(/min-height:\s*48px/);
    }
  });
});
