// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { ANNOUNCE_BATCH_MS, useRosterAnnouncements } from "~/components/event/story/useRosterAnnouncements";

afterEach(() => { vi.useRealTimers(); });
const p = (name: string, userId: string | null = null) => ({ id: name, name, userId });
type Row = ReturnType<typeof p>;

function setup(first: Row[], quiet = () => false, viewerId: string | null = "u-me") {
  vi.useFakeTimers();
  return renderHook(({ players }) => useRosterAnnouncements(players, viewerId, quiet), { initialProps: { players: first } });
}

describe("useRosterAnnouncements", () => {
  it("is silent on the first reading", () => {
    const { result } = setup([p("Ana"), p("Beto")]);
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current).toBe("");
  });

  it("says who joined, once the batch window has passed, and clears the sentence later", () => {
    const { result, rerender } = setup([p("Ana Maria")]);
    rerender({ players: [p("Ana Maria"), p("Beto Santos")] });
    expect(result.current).toBe("");
    act(() => { vi.advanceTimersByTime(ANNOUNCE_BATCH_MS + 10); });
    expect(result.current).toBe("Beto S. joined");
    act(() => { vi.advanceTimersByTime(7000); });
    expect(result.current).toBe("");
  });

  it("puts changes that land inside one window into one sentence — rate-limited, not one per poll", () => {
    const { result, rerender } = setup([p("Ana")]);
    rerender({ players: [p("Ana"), p("Beto")] });
    act(() => { vi.advanceTimersByTime(1000); });
    rerender({ players: [p("Ana"), p("Beto"), p("Cris")] });
    act(() => { vi.advanceTimersByTime(ANNOUNCE_BATCH_MS); });
    expect(result.current).toBe("Beto and Cris joined");
  });

  it("counts instead of listing when more than three people moved", () => {
    const { result, rerender } = setup([p("Ana")]);
    rerender({ players: [p("Ana"), p("B"), p("C"), p("D"), p("E")] });
    act(() => { vi.advanceTimersByTime(ANNOUNCE_BATCH_MS + 10); });
    expect(result.current).toBe("4 people joined");
  });

  it("says nothing for someone who joined and left inside the same window", () => {
    const { result, rerender } = setup([p("Ana")]);
    rerender({ players: [p("Ana"), p("Beto")] });
    rerender({ players: [p("Ana")] });
    act(() => { vi.advanceTimersByTime(ANNOUNCE_BATCH_MS + 10); });
    expect(result.current).toBe("");
  });

  it("stays silent while the viewer's own change is moving the list, and takes the result as the new starting point", () => {
    let busy = true;
    const { result, rerender } = setup([p("Ana")], () => busy);
    rerender({ players: [p("Ana"), p("Rui")] });
    busy = false;
    rerender({ players: [p("Ana"), p("Rui")] });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current).toBe("");
  });

  it("never announces the viewer's own row, as when they join on another device", () => {
    const { result, rerender } = setup([p("Ana")]);
    rerender({ players: [p("Ana"), p("Jose Silva", "u-me")] });
    act(() => { vi.advanceTimersByTime(10_000); });
    expect(result.current).toBe("");
  });

  it("clears its timers when the page goes away", () => {
    const { rerender, unmount } = setup([p("Ana")]);
    rerender({ players: [p("Ana"), p("Beto")] });
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
