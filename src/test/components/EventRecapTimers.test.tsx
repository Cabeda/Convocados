// @vitest-environment jsdom
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, act, renderHook } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { cssFor } from "../emotionCss";
import { EventRecap } from "~/components/event/story/EventRecap";
import { usePostGameStatus, applyOptimistic, type PostGameStatus } from "~/components/event/story/postGameStatus";

const headers = new Headers({ "Content-Type": "application/json" });
const NOW = new Date("2026-03-05T12:00:00Z");
const hours = (h: number) => new Date(NOW.getTime() + h * 3_600_000).toISOString();

let live: PostGameStatus;
let reads = 0;
const base: PostGameStatus = {
  gameEnded: true, hasScore: true, hasCost: false, allPaid: true, allComplete: true, isParticipant: true, isPlayer: true,
  latestHistoryId: "h1", costCurrency: "EUR", costAmount: null, hasPendingPastPayments: false, mvpEnabled: false,
  mvpComplete: true, bannerMvpComplete: true, myMvpComplete: true, scoreOne: 5, scoreTwo: 3,
  teamOneName: "Foxes", teamTwoName: "Lions", viewerTeam: 0, lastGameDateTime: hours(-20), isRecurring: true,
  gamePayments: null, gameConfig: null,
};

const setHidden = (hidden: boolean) => Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });

beforeEach(() => {
  reads = 0;
  live = base;
  localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  setHidden(false);
  vi.stubGlobal("fetch", vi.fn(() => { reads++; return Promise.resolve({ ok: true, status: 200, headers, json: async () => live }); }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); delete document.hidden; });

const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

describe("usePostGameStatus polling", () => {
  it("does not fetch at mount when the page already seeded the status", async () => {
    renderHook(() => usePostGameStatus("e1", base));
    await advance(100);
    expect(reads).toBe(0);
  });

  it("fetches at mount when nothing was seeded, and says it is loaded", async () => {
    const { result } = renderHook(() => usePostGameStatus("e1", null));
    expect(result.current.loaded).toBe(false);
    await advance(10);
    expect(reads).toBe(1);
    expect(result.current.loaded).toBe(true);
    expect(result.current.status).toMatchObject({ teamOneName: "Foxes" });
  });

  it("polls every 15 seconds while the tab is visible", async () => {
    renderHook(() => usePostGameStatus("e1", base));
    await advance(15_000);
    expect(reads).toBe(1);
    await advance(30_000);
    expect(reads).toBe(3);
  });

  it("sleeps while the tab is hidden and reads once when it comes back", async () => {
    renderHook(() => usePostGameStatus("e1", base));
    setHidden(true);
    await advance(60_000);
    expect(reads).toBe(0);
    setHidden(false);
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); });
    expect(reads).toBe(1);
  });

  it("sleeps while the caller says the recap is gone", async () => {
    const { result } = renderHook(() => usePostGameStatus("e1", base));
    act(() => result.current.setPaused(true));
    await advance(60_000);
    expect(reads).toBe(0);
    act(() => result.current.setPaused(false));
    await advance(15_000);
    expect(reads).toBe(1);
  });

  it("leaves no timer or listener behind when it unmounts", async () => {
    const remove = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => usePostGameStatus("e1", base));
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});

describe("usePostGameStatus: static fields ride on the page load, the poll only carries what changes", () => {
  const seeded: PostGameStatus = { ...base, viewerNames: ["anab99", "Ana"], payerHasPaymentDetails: true };
  let urls: string[];
  /** What the server sends: a poll leaves the static fields out (see post-game-status `?poll=1`). */
  const serve = () => vi.stubGlobal("fetch", vi.fn((url: string) => {
    urls.push(url);
    const { viewerNames: _names, payerHasPaymentDetails: _details, ...dynamic } = live;
    return Promise.resolve({ ok: true, status: 200, headers, json: async () => (url.includes("poll=1") ? dynamic : live) });
  }));
  beforeEach(() => { urls = []; live = { ...seeded }; serve(); });

  it("asks the server for the light answer on every poll tick", async () => {
    renderHook(() => usePostGameStatus("e1", seeded));
    await advance(30_000);
    expect(urls).toHaveLength(2);
    expect(urls.every((u) => u.includes("/api/events/e1/post-game-status") && u.includes("poll=1"))).toBe(true);
  });

  it("asks for the light answer when the tab comes back too", async () => {
    renderHook(() => usePostGameStatus("e1", seeded));
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); await Promise.resolve(); });
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain("poll=1");
  });

  it("keeps the names and the payment-details flag from the first payload between polls, while the rest updates", async () => {
    const { result } = renderHook(() => usePostGameStatus("e1", seeded));
    live = { ...seeded, scoreOne: 7, hasPendingPastPayments: true };
    await advance(15_000);
    expect(result.current.status).toMatchObject({ scoreOne: 7, viewerNames: ["anab99", "Ana"], payerHasPaymentDetails: true });
    await advance(15_000);
    expect(result.current.status).toMatchObject({ viewerNames: ["anab99", "Ana"], payerHasPaymentDetails: true });
  });

  it("a read the viewer asked for (after an action) is the full answer and replaces the static fields", async () => {
    const { result } = renderHook(() => usePostGameStatus("e1", seeded));
    live = { ...seeded, viewerNames: ["anab99", "Ana", "Zed"], payerHasPaymentDetails: false };
    await act(async () => { await result.current.refresh(); });
    expect(urls[0]).not.toContain("poll=1");
    expect(result.current.status).toMatchObject({ viewerNames: ["anab99", "Ana", "Zed"], payerHasPaymentDetails: false });
  });

  it("the very first read of a page that was not seeded is a full one", async () => {
    const { result } = renderHook(() => usePostGameStatus("e1", null));
    await advance(10);
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain("poll=1");
    expect(result.current.status?.viewerNames).toEqual(["anab99", "Ana"]);
  });

  it("when a poll shows a different last game, it follows up with one full read for that game's static fields", async () => {
    const { result } = renderHook(() => usePostGameStatus("e1", seeded));
    live = { ...seeded, latestHistoryId: "h2", payerHasPaymentDetails: false, viewerNames: ["anab99", "Ana", "Zed"] };
    await advance(15_000);
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain("poll=1");
    expect(urls[1]).not.toContain("poll=1");
    expect(result.current.status).toMatchObject({ latestHistoryId: "h2", payerHasPaymentDetails: false, viewerNames: ["anab99", "Ana", "Zed"] });
  });

  it("a poll that fails keeps the last status, static fields included", async () => {
    const { result } = renderHook(() => usePostGameStatus("e1", seeded));
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("offline"))));
    await advance(15_000);
    expect(result.current.status).toMatchObject({ viewerNames: ["anab99", "Ana"], payerHasPaymentDetails: true });
  });
});

describe("EventRecap clock", () => {
  const mount = (over = {}) => renderWithTheme(
    <EventRecap eventId="e1" initialStatus={base} viewerName="Ana" isAuthenticated canManage={false} isRecurring
      nextKickoff={hours(72)} timezone="UTC" deepLinkAction={null} {...over} />,
  );

  it("does not tick every minute: one timeout for the one moment the phase can change", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    mount();
    // the poll is the only interval; the old once-a-minute `now` ticker is gone
    const periods = setIntervalSpy.mock.calls.map((c) => c[1]);
    expect(periods).not.toContain(60_000);
  });

  it("drops the recap by itself when game day arrives while the page is open", async () => {
    mount({ nextKickoff: hours(7) }); // 6h before kickoff is in one hour
    expect(screen.getByTestId("last-game-recap")).toBeInTheDocument();
    await advance(61 * 60_000);
    expect(screen.queryByTestId("last-game-recap")).toBeNull();
  });

  it("waits for game day with one long timeout for a weekly event, and for nothing for a one-off", async () => {
    const longWaits = () => vi.mocked(setTimeout).mock.calls.filter((c) => (c[1] ?? 0) >= 3_600_000).length;
    vi.spyOn(globalThis, "setTimeout");
    mount({ isRecurring: false, nextKickoff: hours(72) });
    expect(longWaits()).toBe(0);
    cleanup();
    mount({ isRecurring: true, nextKickoff: hours(72) });
    expect(longWaits()).toBe(1);
  });

  it("stops polling once the recap is gone, and cleans up everything on unmount", async () => {
    const view = mount({ nextKickoff: hours(7) });
    await advance(61 * 60_000);
    const seen = reads;
    await advance(60_000);
    expect(reads).toBe(seen);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("EventRecap skeleton", () => {
  const unseeded = (over = {}) => renderWithTheme(
    <EventRecap eventId="e1" initialStatus={null} viewerName={null} isAuthenticated={false} canManage={false} isRecurring hasLastGame
      nextKickoff={hours(72)} timezone="UTC" deepLinkAction={null} {...over} />,
  );

  it("holds the card's place until the first read comes back, then swaps it for the real card", async () => {
    unseeded();
    expect(screen.getByTestId("recap-skeleton")).toBeInTheDocument();
    await advance(10);
    expect(screen.queryByTestId("recap-skeleton")).toBeNull();
    expect(screen.getByTestId("last-game-recap")).toBeInTheDocument();
  });

  it("shows nothing for an event that has not been played and does not repeat", async () => {
    unseeded({ isRecurring: false, hasLastGame: false });
    expect(screen.queryByTestId("recap-skeleton")).toBeNull();
  });

  it("does not hold a place for a weekly game that has never been played: there is nothing coming to fill it", () => {
    unseeded({ hasLastGame: false });
    expect(screen.queryByTestId("recap-skeleton")).toBeNull();
  });

  it("holds the place for a one-off whose game is over, even before the payload names a last game", () => {
    unseeded({ isRecurring: false, hasLastGame: false, nextKickoff: hours(-3) });
    expect(screen.getByTestId("recap-skeleton")).toBeInTheDocument();
  });

  it("is a one-line strip when the viewer last saw the strip", () => {
    localStorage.setItem("recap:shape:e1", "strip");
    unseeded();
    expect(cssFor(screen.getByTestId("recap-skeleton").firstChild)).toMatch(/min-height:\s*66px/);
  });

  it("is never shown when the page already seeded the status", () => {
    renderWithTheme(
      <EventRecap eventId="e1" initialStatus={base} viewerName="Ana" isAuthenticated canManage={false} isRecurring
        nextKickoff={hours(72)} timezone="UTC" deepLinkAction={null} />,
    );
    expect(screen.queryByTestId("recap-skeleton")).toBeNull();
    expect(screen.getByTestId("last-game-recap")).toBeInTheDocument();
  });
});

describe("applyOptimistic", () => {
  const pending = { ...base, myMvpComplete: false, hasScore: false, scoreOne: null, scoreTwo: null,
    gamePayments: [{ eventPlayerId: "a", name: "Ana", amount: 5, status: "pending", isPayer: false }] };

  it("layers what the viewer just did over a stale status", () => {
    const out = applyOptimistic(pending, { score: [2, 1], voted: true, paidIds: ["a"] });
    expect(out).toMatchObject({ hasScore: true, scoreOne: 2, scoreTwo: 1, myMvpComplete: true });
    expect(out.gamePayments[0].status).toBe("sent");
  });

  it("lets the server win once it has the score", () => {
    expect(applyOptimistic(base, { score: [9, 9] })).toMatchObject({ scoreOne: 5, scoreTwo: 3 });
  });

  it("leaves a paid row paid", () => {
    const paid = { ...pending, gamePayments: [{ ...pending.gamePayments[0], status: "paid" }] };
    expect(applyOptimistic(paid, { paidIds: ["a"] }).gamePayments[0].status).toBe("paid");
  });

  it("changes nothing when nothing was done", () => {
    expect(applyOptimistic(pending, {})).toBe(pending);
  });
});
