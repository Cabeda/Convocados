// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { EventRecap, type EventRecapProps } from "~/components/event/story/EventRecap";
import type { PostGameStatus } from "~/components/event/story/postGameStatus";

const headers = new Headers({ "Content-Type": "application/json" });
const NOW = new Date("2026-03-05T12:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

let live: PostGameStatus;
let postStatus = 200;
const calls: Array<{ url: string; method: string; body?: unknown }> = [];

beforeEach(() => {
  localStorage.clear();
  calls.length = 0;
  postStatus = 200;
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn((url: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push({ url: String(url), method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (method !== "GET") return Promise.resolve({ ok: postStatus < 400, status: postStatus, headers, json: async () => ({}) });
    if (String(url).includes("/mvp")) {
      return Promise.resolve({ ok: true, status: 200, headers, json: async () => ({ isVotingOpen: true, participants: [{ id: "p1", name: "Rui", voteCount: 0 }, { id: "p2", name: "Bia", voteCount: 0 }] }) });
    }
    return Promise.resolve({ ok: true, status: 200, headers, json: async () => live });
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const base: PostGameStatus = {
  gameEnded: true, hasScore: true, hasCost: true, allPaid: false, allComplete: false, isParticipant: true, isPlayer: true,
  latestHistoryId: "h1", costCurrency: "EUR", costAmount: 50, hasPendingPastPayments: true, mvpEnabled: true,
  mvpComplete: false, bannerMvpComplete: false, myMvpComplete: true, scoreOne: 5, scoreTwo: 3,
  teamOneName: "Foxes", teamTwoName: "Lions", viewerTeam: 0, lastGameDateTime: hours(-20), isRecurring: true,
  gamePayments: [
    { eventPlayerId: "ep-ana", name: "Ana", amount: 5, status: "pending", isPayer: false },
    { eventPlayerId: "ep-maria", name: "Maria", amount: 5, status: "paid", isPayer: true },
  ],
  gameConfig: { gameId: "g1", mode: "tracked", payerName: "Maria", payerIsPlayer: true },
};
const afterPay = {
  ...base, allPaid: true, allComplete: true,
  gamePayments: base.gamePayments.map((r) => (r.name === "Ana" ? { ...r, status: "sent" } : r)),
};

function mount(status: PostGameStatus, over: Partial<EventRecapProps> = {}) {
  live = status;
  return renderWithTheme(
    <EventRecap eventId="e1" initialStatus={status} viewerName="Ana" isAuthenticated canManage={false} isRecurring
      nextKickoff={hours(72)} timezone="UTC" deepLinkAction={null} {...over} />,
  );
}
const seen = () => localStorage.setItem("recap:seen:e1:h1", "1");
const details = () => document.getElementById("recap-details-e1");
const flush = () => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe("finishing the last task on a revisit", () => {
  it("keeps the card open and says what happened — it never folds the confirmation away", async () => {
    seen();
    mount(base);
    fireEvent.click(await screen.findByRole("button", { name: "I've paid" }));
    await flush();
    live = afterPay; // the server now agrees: nothing is left
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });

    expect(details()).not.toHaveAttribute("aria-hidden", "true");
    expect(details()).not.toHaveAttribute("inert");
    expect(screen.getByTestId("recap-live")).toHaveTextContent("You said you paid €5 · waiting for Maria");
    expect(screen.getByRole("button", { name: "Hide details of the last game" })).toHaveAttribute("aria-expanded", "true");
  });

  it("folds only when the viewer taps Hide", async () => {
    seen();
    mount(base);
    fireEvent.click(await screen.findByRole("button", { name: "I've paid" }));
    await flush();
    fireEvent.click(screen.getByRole("button", { name: "Hide details of the last game" }));
    expect(details()).toHaveAttribute("aria-hidden", "true");
  });

  it("switches the header to All done and keeps what just happened in the live line", async () => {
    seen();
    mount(base);
    fireEvent.click(await screen.findByRole("button", { name: "I've paid" }));
    await flush();
    expect(screen.getByTestId("recap-header-label")).toHaveTextContent("All done");
  });
});

describe("optimistic hide with rollback", () => {
  it("hides the row at once and posts exactly once, even when tapped twice", async () => {
    seen();
    mount(base);
    const pay = await screen.findByRole("button", { name: "I've paid" });
    fireEvent.click(pay);
    fireEvent.click(pay);
    await flush();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "I've paid" })).toBeNull();
  });

  it("does not bring the row back when a stale refresh still says pending", async () => {
    seen();
    mount(base); // the server keeps answering with the OLD pending data
    fireEvent.click(await screen.findByRole("button", { name: "I've paid" }));
    await flush();
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000); }); // a poll lands with stale data
    expect(screen.queryByRole("button", { name: "I've paid" })).toBeNull();
    expect(screen.getByText("You said you paid €5 · waiting for Maria")).toBeInTheDocument();
  });

  it("restores the row and says what went wrong when the server refuses", async () => {
    seen();
    mount(base);
    postStatus = 500;
    fireEvent.click(await screen.findByRole("button", { name: "I've paid" }));
    await flush();
    expect(await screen.findByRole("button", { name: "I've paid" })).toBeEnabled();
    expect(screen.getByRole("alert")).toHaveTextContent("Couldn't send that. Try again.");
    expect(screen.queryByText("You said you paid €5 · waiting for Maria")).toBeNull();
  });
});

describe("focus", () => {
  const withVote = { ...base, myMvpComplete: false, gamePayments: base.gamePayments.map((r) => ({ ...r, status: "paid" })), allPaid: true };

  it("keeps Vote as a toggle and moves focus into the list when it opens", async () => {
    seen();
    mount(withVote);
    const vote = await screen.findByRole("button", { name: "Vote" });
    expect(vote).toHaveAttribute("aria-expanded", "false");
    fireEvent.click(vote);
    const first = await screen.findByRole("radio", { name: "Rui" });
    await waitFor(() => expect(first).toHaveFocus());
    expect(screen.getByRole("button", { name: "Vote" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Vote" }).getAttribute("aria-controls")).toBe(
      first.closest("[role='group']")?.id ?? document.querySelector("[id^='recap-panel']")?.id,
    );
  });

  it("returns focus to the Vote button on Not now", async () => {
    seen();
    mount(withVote);
    fireEvent.click(await screen.findByRole("button", { name: "Vote" }));
    await screen.findByRole("radio", { name: "Rui" });
    fireEvent.click(screen.getByRole("button", { name: "Not now" }));
    expect(screen.getByRole("button", { name: "Vote" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Vote" })).toHaveAttribute("aria-expanded", "false");
  });

  it("moves focus to the live line when a vote is saved", async () => {
    seen();
    mount(withVote);
    fireEvent.click(await screen.findByRole("button", { name: "Vote" }));
    fireEvent.click(await screen.findByRole("radio", { name: "Rui" }));
    fireEvent.click(screen.getByRole("button", { name: "Confirm vote" }));
    await flush();
    expect(screen.getByTestId("recap-live")).toHaveFocus();
    expect(screen.getByTestId("recap-live")).toHaveTextContent("You voted for Rui");
  });
});
