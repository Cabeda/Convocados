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
  viewerTeam: 0,
};

function props(over: Partial<LastGameRecapProps> = {}): LastGameRecapProps {
  return {
    eventId: "e1", status, expanded: true, canCollapse: false, onToggle: vi.fn(), dateLabel: "Wed 4 Mar",
    role: "played", viewerName: "Ana", onChanged: vi.fn(), summary: "You won · +143 points this season",
    tasks: [{ kind: "mvp" }, { kind: "pay", amount: 5, payerName: "Maria", eventPlayerId: "ep-ana" }] as RecapTask[],
    ...over,
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

  it("lists what is left, in order, with named actions", () => {
    show();
    const rows = screen.getAllByTestId("recap-task");
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText("Vote for MVP")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Pay 5.00€")).toBeInTheDocument();
    expect(within(rows[1]).getByText("Maria is collecting")).toBeInTheDocument();
  });

  it("links to the lineup, payments and ranking", () => {
    show();
    expect(screen.getByRole("link", { name: /Lineup/ })).toHaveAttribute("href", "/events/e1/history");
    expect(screen.getByRole("link", { name: /Payments/ })).toHaveAttribute("href", "/events/e1/payments");
    expect(screen.getByRole("link", { name: /Ranking/ })).toHaveAttribute("href", "/events/e1/rankings");
  });

  it("hides the payments link when no cost exists", () => {
    show({ status: { ...status, hasCost: false, gamePayments: null }, tasks: [] });
    expect(screen.queryByRole("link", { name: /Payments/ })).toBeNull();
  });

  it("says all done when nothing is left and the score is in", () => {
    show({ tasks: [] });
    expect(screen.getByText("All done")).toBeInTheDocument();
  });

  it("asks a signed-out viewer to sign in instead of listing tasks", () => {
    show({ role: "signedOut", viewerName: null, tasks: [] });
    expect(screen.getByRole("button", { name: "Sign in" })).toBeInTheDocument();
    expect(screen.getByText("Sign in to vote and see what you owe")).toBeInTheDocument();
    expect(screen.queryByTestId("recap-task")).toBeNull();
  });

  it("shows a missing score as a sentence, not dashes pretending to be a result", () => {
    show({ status: { ...status, hasScore: false, scoreOne: null, scoreTwo: null }, summary: "Score not added yet", tasks: [], role: "absent" });
    expect(screen.getByText("Score not added yet")).toBeInTheDocument();
    expect(screen.getByText("Someone who played will add it soon.")).toBeInTheDocument();
  });
});

describe("LastGameRecap — strip and toggle", () => {
  it("collapses to a strip: toggle reports aria-expanded=false and the tasks are hidden from assistive tech", () => {
    show({ expanded: false });
    const toggle = screen.getByRole("button", { name: "Show details of the last game" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByRole("button", { name: "Pay" })).toBeNull(); // inert + aria-hidden, still in the DOM so it can animate open
    // the scoreboard is still there — it is the same element, resized
    expect(screen.getByTestId("score-one")).toHaveTextContent("5");
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
});

describe("LastGameRecap — actions", () => {
  it("Pay reports the payment, turns into a done row and refreshes", async () => {
    stubFetch();
    const onChanged = vi.fn();
    show({ onChanged });
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(screen.getByText("You said you paid 5.00€")).toBeInTheDocument());
    expect(calls.find((c) => c.method === "POST")).toMatchObject({
      url: "/api/events/e1/payments/settlement/self-report",
      body: { gameId: "g1", eventPlayerId: "ep-ana" },
    });
    expect(onChanged).toHaveBeenCalled();
  });

  it("Pay failure says what happened and keeps the Pay action", async () => {
    stubFetch(() => new Error("x"));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Pay" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn't send that. Try again."));
    expect(screen.getByRole("button", { name: "Pay" })).toBeEnabled();
  });

  it("the collector's row links to who owes", () => {
    show({ role: "played", tasks: [{ kind: "collect", collector: null, paidCount: 2, totalCount: 5, paidAmount: 10, totalAmount: 25 }] });
    expect(screen.getByText("You're collecting")).toBeInTheDocument();
    expect(screen.getByText("10.00€ of 25.00€ · 2 of 5 paid")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "See who owes" })).toHaveAttribute("href", "/events/e1/payments");
  });

  it("names the collector when an admin is only watching", () => {
    show({ role: "absent", tasks: [{ kind: "collect", collector: "Maria", paidCount: 1, totalCount: 2, paidAmount: 5, totalAmount: 10 }] });
    expect(screen.getByText("Maria is collecting")).toBeInTheDocument();
    expect(screen.queryByText("You're collecting")).toBeNull();
  });

  it("opens the MVP picker inline from the Vote action", async () => {
    stubFetch(() => ({ isVotingOpen: true, hasVoted: false, participants: [{ id: "p1", name: "Rui", voteCount: 0 }, { id: "p2", name: "Ana", voteCount: 0 }] }));
    show();
    fireEvent.click(screen.getByRole("button", { name: "Vote" }));
    expect(await screen.findByRole("radio", { name: "Rui" })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "Ana" })).toBeNull(); // cannot vote for yourself
  });

  it("add-score opens the steppers inline when a history row exists", () => {
    show({ status: { ...status, hasScore: false, scoreOne: null, scoreTwo: null }, tasks: [{ kind: "addScore", inline: true }], summary: "Score not added yet" });
    fireEvent.click(screen.getByRole("button", { name: "Add score" }));
    expect(screen.getByRole("button", { name: "One more goal for Shadow Foxes" })).toBeInTheDocument();
  });

  it("add-score falls back to History when the score cannot be saved in place", () => {
    show({ status: { ...status, hasScore: false, scoreOne: null, scoreTwo: null }, tasks: [{ kind: "addScore", inline: false }], summary: "Score not added yet" });
    expect(screen.getByRole("link", { name: "Open history" })).toHaveAttribute("href", "/events/e1/history");
  });

  it("opens the steppers straight away for the add-score deep link", () => {
    show({ status: { ...status, hasScore: false, scoreOne: null, scoreTwo: null }, tasks: [{ kind: "addScore", inline: true }], autoOpenScore: true });
    expect(screen.getByRole("button", { name: "One more goal for Blue Lions" })).toBeInTheDocument();
  });
});
