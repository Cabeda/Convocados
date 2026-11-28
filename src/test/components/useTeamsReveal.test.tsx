import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useTeamsReveal } from "~/components/event/story/useTeamsReveal";

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("useTeamsReveal", () => {
  it("stays quiet for teams that were there from the start", () => {
    const { result } = renderHook(({ has }) => useTeamsReveal(has), { initialProps: { has: true } });
    expect(result.current).toEqual({ reveal: false, announce: false });
  });

  it("reveals once when the teams appear, announces while they stay, and stops revealing after the animation", () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ has }) => useTeamsReveal(has), { initialProps: { has: false } });
    rerender({ has: true });
    expect(result.current).toEqual({ reveal: true, announce: true });
    act(() => { vi.advanceTimersByTime(800); });
    expect(result.current).toEqual({ reveal: false, announce: true });
    rerender({ has: false });
    expect(result.current).toEqual({ reveal: false, announce: false });
  });
});
