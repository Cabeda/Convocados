import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { renderWithTheme } from "../render";
import { NextGame, type NextGameProps } from "~/components/event/story/NextGame";
import { deriveEventPermissions } from "~/lib/eventView";
import { HOUR, WEEKLY, makeEvent } from "./eventPageHarness";

const MIN = 60_000;
const NOW = new Date("2026-12-03T10:00:00Z").getTime();

function Harness({ event, ...over }: { event: Record<string, unknown> } & Omit<Partial<NextGameProps>, "event">) {
  const [current, setCurrent] = useState(event as unknown as NextGameProps["event"]);
  const perms = deriveEventPermissions("u-1", { ownerId: "owner-9", isPublic: false });
  return (
    <NextGame
      eventId="evt-1" event={current} setEvent={setCurrent as unknown as NextGameProps["setEvent"]} refetch={async () => {}} beginWrite={() => () => {}}
      viewer={{ id: "u-1", name: "Jose Silva" }} perms={perms} rsvp={null} setRsvp={() => {}} recapBlocking={false}
      deepLinkAction={null} notify={() => {}} onSignedIn={() => {}}
      {...over}
    />
  );
}

const render = (event: Record<string, unknown>, over: Omit<Partial<NextGameProps>, "event"> = {}) => renderWithTheme(<Harness event={event} {...over} />);
const startIn = (ms: number, extra: Record<string, unknown> = {}) => makeEvent({ dateTime: new Date(NOW + ms).toISOString(), ...extra });
const advance = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } })));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("Next game — the clock", () => {
  it("counts down by the minute with ONE timeout, not a ticker", async () => {
    render(startIn(3 * HOUR + 12 * MIN + 30_000));
    expect(screen.getByTestId("next-game-sub")).toHaveTextContent("Starts in 3 h 13 min");
    expect(vi.getTimerCount()).toBe(1);
    await advance(30_100);
    expect(screen.getByTestId("next-game-sub")).toHaveTextContent("Starts in 3 h 12 min");
    await advance(MIN);
    expect(screen.getByTestId("next-game-sub")).toHaveTextContent("Starts in 3 h 11 min");
    expect(vi.getTimerCount()).toBe(1);
  });

  it("says minutes only under an hour and hours only on the hour", async () => {
    render(startIn(42 * MIN - 1_000));
    expect(screen.getByTestId("next-game-sub")).toHaveTextContent("Starts in 42 min");
    cleanup();
    render(startIn(2 * HOUR - 1_000));
    expect(screen.getByTestId("next-game-sub")).toHaveTextContent("Starts in 2 h");
  });

  it("sleeps until the countdown opens when the game is more than a day away", async () => {
    render(startIn(2 * 24 * HOUR));
    expect(screen.queryByTestId("next-game-sub")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
    await advance(24 * HOUR + 100);
    expect(screen.getByTestId("next-game-sub")).toHaveTextContent(/Starts in 24 h/);
  });

  it("turns into a 'Live now' pill at kickoff, then (weekly) into sign-ups-soon at the end", async () => {
    render(startIn(2 * MIN, { isRecurring: true, recurrenceRule: WEEKLY }));
    expect(screen.queryByTestId("live-pill")).not.toBeInTheDocument();
    await advance(2 * MIN + 100);
    expect(screen.getByTestId("live-pill")).toBeInTheDocument();
    expect(screen.queryByTestId("next-game-sub")).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(1);
    await advance(90 * MIN);
    expect(screen.queryByTestId("live-pill")).not.toBeInTheDocument();
    expect(screen.getByText("Sign-ups open in a moment")).toBeInTheDocument();
    // Nothing left to wait for by the clock alone.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a one-off disappears when it ends", async () => {
    render(startIn(-60 * MIN));
    expect(screen.getByTestId("live-pill")).toBeInTheDocument();
    await advance(31 * MIN);
    expect(screen.queryByTestId("next-game")).not.toBeInTheDocument();
  });

  it("clears its timeout when the page goes away", () => {
    const { unmount } = render(startIn(3 * HOUR));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("sleeps while the tab is hidden and catches up when it is shown again", async () => {
    render(startIn(3 * HOUR + 30_000));
    expect(screen.getByTestId("next-game-sub")).toHaveTextContent("Starts in 3 h 1 min");
    let hidden = true;
    Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(vi.getTimerCount()).toBe(0);
    vi.setSystemTime(NOW + 40 * MIN);
    hidden = false;
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(screen.getByTestId("next-game-sub")).toHaveTextContent("Starts in 2 h 21 min");
    expect(vi.getTimerCount()).toBe(1);
    delete (document as { hidden?: boolean }).hidden;
  });
});

describe("Next game — the RSVP is THE action only when nothing else is waiting for the viewer", () => {
  it("is the filled primary pill when the recap has nothing for the viewer", () => {
    render(startIn(5 * 24 * HOUR));
    expect(screen.getByRole("button", { name: "I'm in" })).toHaveClass("MuiButton-contained");
  });
  it("is the quiet outlined pill while the recap still has a task for the viewer", () => {
    render(startIn(5 * 24 * HOUR), { recapBlocking: true });
    expect(screen.getByRole("button", { name: "I'm in" })).toHaveClass("MuiButton-outlined");
    expect(screen.getByRole("button", { name: "I'm in" })).not.toHaveClass("MuiButton-contained");
  });
});
