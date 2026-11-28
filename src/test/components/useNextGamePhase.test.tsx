// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useNextGamePhase } from "~/components/event/story/useNextGamePhase";

afterEach(() => { vi.useRealTimers(); });

describe("useNextGamePhase", () => {
  it("moves open → live → signups soon at kickoff and at the end, with no timer in between", () => {
    vi.useFakeTimers();
    const start = Date.now() + 10 * 60_000;
    const { result } = renderHook(() => useNextGamePhase(start, 90, true, false));
    expect(result.current).toBe("open");
    act(() => { vi.advanceTimersByTime(10 * 60_000 + 100); });
    expect(result.current).toBe("live");
    act(() => { vi.advanceTimersByTime(90 * 60_000); });
    expect(result.current).toBe("signupsSoon");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not re-render every minute of the countdown", () => {
    vi.useFakeTimers();
    let renders = 0;
    const start = Date.now() + 5 * 3_600_000;
    renderHook(() => { renders += 1; return useNextGamePhase(start, 90, false, false); });
    const before = renders;
    act(() => { vi.advanceTimersByTime(3 * 3_600_000); });
    expect(renders).toBe(before);
  });

  it("catches up when the tab is shown again", () => {
    vi.useFakeTimers();
    const start = Date.now() + 60_000;
    const { result } = renderHook(() => useNextGamePhase(start, 90, false, false));
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    act(() => { vi.setSystemTime(start + 100 * 60_000); });
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    act(() => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(result.current).toBe("none");
  });

  it("is cancelled when the game is cancelled", () => {
    const { result } = renderHook(() => useNextGamePhase(Date.now() + 3_600_000, 90, true, true));
    expect(result.current).toBe("cancelled");
  });
});
