// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { EventRecap, type EventRecapProps } from "~/components/event/story/EventRecap";
import type { PostGameStatus } from "~/components/event/story/postGameStatus";

const headers = new Headers({ "Content-Type": "application/json" });
let live: PostGameStatus;
const NOW = new Date("2026-03-05T12:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubGlobal("fetch", vi.fn((_url: string, init?: RequestInit) => Promise.resolve({
    ok: true, status: 200, headers, json: async () => (init?.method && init.method !== "GET" ? {} : live),
  })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

const base: PostGameStatus = {
  gameEnded: false, hasScore: true, hasCost: true, allPaid: false, allComplete: false, isParticipant: true, isPlayer: true,
  latestHistoryId: "h1", costCurrency: "EUR", costAmount: 50, hasPendingPastPayments: true, mvpEnabled: false,
  mvpComplete: true, bannerMvpComplete: true, myMvpComplete: true, scoreOne: 5, scoreTwo: 3,
  teamOneName: "Foxes", teamTwoName: "Lions", viewerTeam: 0, lastGameDateTime: hours(-20), isRecurring: true,
  gamePayments: [
    { eventPlayerId: "ep-ana", name: "Ana", amount: 5, status: "pending", isPayer: false },
    { eventPlayerId: "ep-maria", name: "Maria", amount: 5, status: "paid", isPayer: true },
  ],
  gameConfig: { gameId: "g1", mode: "tracked", payerName: "Maria", payerIsPlayer: true },
};
const paid = { ...base, allPaid: true, hasPendingPastPayments: false, allComplete: true, viewerPaymentSettled: true,
  gamePayments: base.gamePayments.map((r) => ({ ...r, status: "paid" })) };

function mount(status: PostGameStatus, over: Partial<EventRecapProps> = {}) {
  live = status;
  return renderWithTheme(
    <EventRecap eventId="e1" initialStatus={status} viewerName="Ana" isAuthenticated canManage={false} isRecurring
      nextKickoff={hours(72)} timezone="UTC" deepLinkAction={null} {...over} />,
  );
}

describe("EventRecap", () => {
  it("shows the full card with what is left to a player who owes", async () => {
    mount(base);
    expect(await screen.findByText("You owe €5")).toBeInTheDocument();
    expect(screen.getByText("You won")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "I've paid" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hide details of the last game" })).toBeNull(); // a task is left
  });

  it("shows the full card once when everything is done, then a strip on the next visit", async () => {
    const first = mount(paid);
    expect(await screen.findByText("All done")).toBeInTheDocument();
    expect(localStorage.getItem("recap:seen:e1:h1")).toBe("1");
    first.unmount();
    mount(paid);
    const toggle = await screen.findByRole("button", { name: "Show details of the last game" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("gives someone who did not play the strip only, with the result", async () => {
    mount({ ...base, isPlayer: false, viewerTeam: null, isParticipant: false, gamePayments: null },
      { viewerName: "Zed" });
    expect(await screen.findByRole("button", { name: "Show details of the last game" })).toBeInTheDocument();
    expect(screen.getByTestId("recap-header-label")).toHaveTextContent("Foxes won");
    fireEvent.click(screen.getByRole("button", { name: "Show details of the last game" }));
    expect(screen.queryByRole("button", { name: "I've paid" })).toBeNull();
  });

  it("gives a signed-out visitor the result and a sign-in row", async () => {
    mount({ ...base, isPlayer: false, viewerTeam: null, isParticipant: false }, { viewerName: null, isAuthenticated: false });
    expect(await screen.findByText("Sign in to vote and see what you owe")).toBeInTheDocument();
    expect(screen.getByText("Foxes won")).toBeInTheDocument();
  });

  it("renders nothing without a last game", async () => {
    const { container } = mount({ ...base, lastGameDateTime: null });
    await waitFor(() => expect(container.querySelector("[data-testid='last-game-recap']")).toBeNull());
  });

  it("drops the recap on game day but keeps a reminder for an unpaid share", async () => {
    mount(base, { nextKickoff: hours(2) });
    expect(await screen.findByText("You still owe €5")).toBeInTheDocument();
    expect(screen.queryByTestId("last-game-recap")).toBeNull();
  });

  it("drops the recap on game day entirely when nothing is owed", async () => {
    const { container } = mount(paid, { nextKickoff: hours(2) });
    await waitFor(() => expect(container.firstChild).toBeNull());
  });

  it("never hides the recap of a one-off event", async () => {
    mount(paid, { isRecurring: false, nextKickoff: null });
    expect(await screen.findByTestId("last-game-recap")).toBeInTheDocument();
  });

  it("opens the score steppers for ?action=add-score without leaving the page", async () => {
    mount({ ...base, hasScore: false, scoreOne: null, scoreTwo: null, hasPendingPastPayments: false, allPaid: true },
      { deepLinkAction: "add-score" });
    expect(await screen.findByRole("button", { name: "One more for Foxes" })).toBeInTheDocument();
  });

  it("lets the owner of a one-off see the recurrence offer once everything is done — flat, not as a second card", async () => {
    mount({ ...paid, isRecurring: false }, { canManage: true, isRecurring: false });
    const prompt = await screen.findByTestId("recurrence-prompt");
    expect(prompt.closest(".MuiPaper-root")).toBeNull();
  });

  it("does not show the Weekly card on an event that already repeats", async () => {
    mount({ ...paid, isRecurring: true }, { canManage: true, isRecurring: true });
    await screen.findByTestId("last-game-recap");
    expect(screen.queryByTestId("recurrence-already")).toBeNull();
    expect(screen.queryByTestId("recurrence-prompt")).toBeNull();
    expect(screen.queryByText(/repeats every week/i)).toBeNull();
  });

  it("does not offer the recurrence to a viewer who cannot manage the event", async () => {
    mount({ ...paid, isRecurring: false }, { canManage: false, isRecurring: false });
    await screen.findByTestId("last-game-recap");
    expect(screen.queryByTestId("recurrence-prompt")).toBeNull();
  });

  it("finds the linked player when the account name is not the roster name", async () => {
    mount({ ...base, viewerNames: ["anab99", "Ana"] }, { viewerName: "anab99" });
    expect(await screen.findByRole("button", { name: "I've paid" })).toBeInTheDocument();
  });

  it("does not show the amber dot for information the viewer cannot act on", async () => {
    mount({ ...base, gameConfig: { ...base.gameConfig, payerName: null } });
    expect(await screen.findByText("You owe €5")).toBeInTheDocument();
    expect(screen.queryByTestId("needs-you-dot")).toBeNull();
  });

  it("?action=pay scrolls the pay ROW into view, not the card", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mount(base, { deepLinkAction: "pay" });
    await screen.findByText("You owe €5");
    await waitFor(() => expect(scroll).toHaveBeenCalledTimes(1));
    const row = scroll.mock.contexts[0] as HTMLElement;
    expect(row.getAttribute("data-testid")).toBe("recap-task");
    expect(row).toHaveTextContent("You owe €5");
  });

  it("on game day ?action=pay lands on the reminder, which says where to pay", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mount(base, { nextKickoff: hours(2), deepLinkAction: "pay" });
    await screen.findByText("You still owe €5");
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(screen.getByRole("link", { name: "Payments" })).toHaveAttribute("href", "/events/e1/payments");
  });

  it("the reminder says what you reported once you tap I've paid", async () => {
    mount(base, { nextKickoff: hours(2) });
    fireEvent.click(await screen.findByRole("button", { name: "I've paid" }));
    expect(await screen.findByText("You said you paid €5 · waiting for Maria")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "I've paid" })).toBeNull();
  });
});
