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

  describe("?action=add-score reaches score entry for every case", () => {
    const missing = { ...base, hasScore: false, scoreOne: null, scoreTwo: null, hasPendingPastPayments: false, allPaid: true };
    let assign: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      assign = vi.fn();
      vi.stubGlobal("location", { href: "http://localhost/events/e1?action=add-score", pathname: "/events/e1", search: "?action=add-score", assign });
    });

    it.each(["tennis", "padel"])("sends a %s player to the History page, where sets are entered", async (sport) => {
      mount(missing, { deepLinkAction: "add-score", sport });
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/events/e1/history"));
      expect(assign).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole("button", { name: "One more for Foxes" })).toBeNull();
    });

    it("sends the owner of a sets sport who did not play to History too", async () => {
      mount({ ...missing, isPlayer: false, viewerTeam: null }, { deepLinkAction: "add-score", sport: "tennis", canManage: true, viewerName: "Zed" });
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/events/e1/history"));
    });

    it("sends a game with no history row yet to History, where the score can be saved", async () => {
      mount({ ...missing, latestHistoryId: null }, { deepLinkAction: "add-score" });
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/events/e1/history"));
    });

    it("stays on the page and opens the steppers for a game that can be scored in place", async () => {
      mount(missing, { deepLinkAction: "add-score" });
      expect(await screen.findByRole("button", { name: "One more for Foxes" })).toBeInTheDocument();
      expect(assign).not.toHaveBeenCalled();
    });

    it("goes nowhere when the score is already in", async () => {
      mount(base, { deepLinkAction: "add-score", sport: "tennis" });
      await screen.findByTestId("last-game-recap");
      expect(assign).not.toHaveBeenCalled();
    });

    it("goes nowhere for somebody who may not add the score", async () => {
      mount({ ...missing, isPlayer: false, viewerTeam: null }, { deepLinkAction: "add-score", sport: "tennis", viewerName: "Zed" });
      await screen.findByTestId("last-game-recap");
      expect(assign).not.toHaveBeenCalled();
    });

    it("navigates once, however often the status refreshes", async () => {
      mount(missing, { deepLinkAction: "add-score", sport: "padel" });
      await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
      await new Promise((r) => setTimeout(r, 30));
      expect(assign).toHaveBeenCalledTimes(1);
    });

    it("on game day opens the steppers in the reminder, not a redirect", async () => {
      mount(missing, { deepLinkAction: "add-score", nextKickoff: hours(2) });
      expect(await screen.findByRole("button", { name: "One more for Foxes" })).toBeInTheDocument();
      expect(screen.getByTestId("recap-score-reminder")).toBeInTheDocument();
      expect(assign).not.toHaveBeenCalled();
    });

    it("on game day a sets sport still lands on History", async () => {
      mount(missing, { deepLinkAction: "add-score", nextKickoff: hours(2), sport: "tennis" });
      await waitFor(() => expect(assign).toHaveBeenCalledWith("/events/e1/history"));
    });
  });

  describe("game day does not hide an unfinished score entry", () => {
    const missing = { ...base, hasScore: false, scoreOne: null, scoreTwo: null, mvpEnabled: true, myMvpComplete: false };

    it("keeps ONLY the add-score row (no scoreboard card, no MVP, no pay row) inside the 6 h window", async () => {
      mount({ ...missing, hasPendingPastPayments: false, allPaid: true, viewerPaymentSettled: true }, { nextKickoff: hours(2) });
      const row = await screen.findByTestId("recap-score-reminder");
      expect(row).toHaveTextContent("Add the score");
      expect(screen.queryByTestId("last-game-recap")).toBeNull();
      expect(screen.queryByText("Vote for the MVP")).toBeNull();
      expect(screen.queryByText(/You (still )?owe/)).toBeNull();
    });

    it("shows the owe reminder next to it when the viewer also owes", async () => {
      mount(missing, { nextKickoff: hours(2) });
      expect(await screen.findByTestId("recap-score-reminder")).toBeInTheDocument();
      expect(screen.getByText("You still owe €5")).toBeInTheDocument();
    });

    it("lets the owner who did not play add it too", async () => {
      mount({ ...missing, isPlayer: false, viewerTeam: null }, { nextKickoff: hours(2), canManage: true, viewerName: "Zed" });
      expect(await screen.findByTestId("recap-score-reminder")).toBeInTheDocument();
    });

    it("shows nothing for somebody who may not add the score", async () => {
      const { container } = mount({ ...missing, isPlayer: false, viewerTeam: null, gamePayments: null }, { nextKickoff: hours(2), viewerName: "Zed" });
      await waitFor(() => expect(container.querySelector("[data-testid='recap-score-reminder']")).toBeNull());
    });

    it("saves in place, keeps the result on screen and says so", async () => {
      mount({ ...missing, hasPendingPastPayments: false, allPaid: true }, { nextKickoff: hours(2) });
      fireEvent.click(await screen.findByRole("button", { name: "Add score" }));
      fireEvent.click(await screen.findByRole("button", { name: "One more for Foxes" }));
      fireEvent.click(screen.getByRole("button", { name: "Save score" }));
      expect(await screen.findByText("Score saved")).toBeInTheDocument();
      expect(screen.getByTestId("recap-score-reminder").querySelector("[role='status']")).toHaveTextContent("Score saved");
      const call = (fetch as any).mock.calls.find((c: any[]) => c[1]?.method === "PATCH");
      expect(call[0]).toContain("/api/events/e1/history/h1");
      expect(JSON.parse(call[1].body)).toEqual({ scoreOne: 1, scoreTwo: 0 });
    });

    it("takes the saved score back and says what to do when the server refuses", async () => {
      mount({ ...missing, hasPendingPastPayments: false, allPaid: true }, { nextKickoff: hours(2) });
      (fetch as any).mockImplementation((_u: string, init?: RequestInit) =>
        init?.method === "PATCH"
          ? Promise.resolve({ ok: false, status: 500, headers, json: async () => ({ error: "x" }) })
          : Promise.resolve({ ok: true, status: 200, headers, json: async () => live }));
      fireEvent.click(await screen.findByRole("button", { name: "Add score" }));
      fireEvent.click(await screen.findByRole("button", { name: "One more for Foxes" }));
      fireEvent.click(screen.getByRole("button", { name: "Save score" }));
      expect(await screen.findByRole("alert")).toHaveTextContent(/couldn.t save/i);
      expect(screen.queryByText("Score saved")).toBeNull();
    });

    it("a sets sport gets a link to History instead of steppers", async () => {
      mount({ ...missing, hasPendingPastPayments: false, allPaid: true }, { nextKickoff: hours(2), sport: "padel" });
      const link = await screen.findByRole("link", { name: "Open history" });
      expect(link).toHaveAttribute("href", "/events/e1/history");
    });

    it("outside the window nothing changes: the full card carries the row", async () => {
      mount({ ...missing, hasPendingPastPayments: false, allPaid: true }, { nextKickoff: hours(72) });
      await screen.findByTestId("last-game-recap");
      expect(screen.queryByTestId("recap-score-reminder")).toBeNull();
    });
  });
});

describe("EventRecap — telling the page whether the viewer still has something to do", () => {
  it("is blocking while the recap shows a task for the viewer", async () => {
    const onBlockingChange = vi.fn();
    mount(base, { onBlockingChange });
    await screen.findByText("You owe €5");
    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
  });

  it("is not blocking once everything is done", async () => {
    const onBlockingChange = vi.fn();
    mount(paid, { onBlockingChange });
    await screen.findByText("All done");
    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
    expect(onBlockingChange).not.toHaveBeenCalledWith(true);
  });

  it("is not blocking when the recap is gone on game day and the viewer owes nothing", async () => {
    const onBlockingChange = vi.fn();
    mount(paid, { nextKickoff: hours(2), onBlockingChange });
    await waitFor(() => expect(onBlockingChange).toHaveBeenCalled());
    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
  });

  it("goes quiet to blocking and back when the task is completed", async () => {
    const onBlockingChange = vi.fn();
    mount(base, { onBlockingChange });
    fireEvent.click(await screen.findByRole("button", { name: "I've paid" }));
    await waitFor(() => expect(onBlockingChange).toHaveBeenLastCalledWith(false));
    expect(onBlockingChange).toHaveBeenCalledWith(true);
  });
});
