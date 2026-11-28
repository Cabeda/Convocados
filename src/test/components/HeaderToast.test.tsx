/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, act, renderHook } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { HeaderToast, useHeaderToasts } from "~/components/event/story/HeaderToast";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Host() {
  const { queue, push, next } = useHeaderToasts();
  return (<><button onClick={() => { push("Following"); push("Blocked"); }}>go</button><HeaderToast queue={queue} onDone={next} /></>);
}


describe("the header toast queue", () => {
  it("shows the second message only after the first has had its time", async () => {
    vi.useFakeTimers();
    renderWithTheme(<Host />);
    act(() => { screen.getByText("go").click(); });
    expect(screen.getByRole("status")).toHaveTextContent("Following");
    expect(screen.queryByText("Blocked")).not.toBeInTheDocument();
    await act(async () => { vi.advanceTimersByTime(4200); });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(screen.getByRole("status")).toHaveTextContent("Blocked");
  });

  it("does not queue the same message twice in a row", () => {
    const { result } = renderHook(() => useHeaderToasts());
    act(() => { result.current.push("Saved"); result.current.push("Saved"); });
    expect(result.current.queue).toEqual(["Saved"]);
  });
});
