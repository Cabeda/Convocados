/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, act, renderHook } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { HeaderToast, useHeaderToasts } from "~/components/event/story/HeaderToast";
import { BottomSlotProvider, useBottomSlotClaim } from "~/lib/bottomSlot";
import { cssFor } from "../emotionCss";

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Host() {
  const { queue, push, next } = useHeaderToasts();
  return (<><button onClick={() => { push("Following"); push("Blocked"); }}>go</button><HeaderToast queue={queue} onDone={next} /></>);
}


function Claim({ id }: { id: "update" | "install" | "push" }) { useBottomSlotClaim(id, true); return null; }

describe("the header toast and the fixed banners", () => {
  // Where it ends up is layout: e2e/event-recap-layout.spec.ts checks the toast clears the Update banner in a real browser.
  const root = () => screen.getByRole("status").closest(".MuiSnackbar-root") as HTMLElement;

  it("rides above an update banner instead of sitting under it", async () => {
    renderWithTheme(<BottomSlotProvider><Claim id="update" /><HeaderToast queue={["Saved"]} onDone={() => {}} /></BottomSlotProvider>);
    expect(cssFor(root())).toMatch(/bottom:\s*calc\(6rem/);
  });

  it("stays where it is for the inline push prompt and with no banner", async () => {
    const { unmount } = renderWithTheme(<BottomSlotProvider><Claim id="push" /><HeaderToast queue={["Saved"]} onDone={() => {}} /></BottomSlotProvider>);
    expect(cssFor(root())).not.toMatch(/6rem/);
    unmount();
    renderWithTheme(<HeaderToast queue={["Saved"]} onDone={() => {}} />);
    expect(cssFor(root())).not.toMatch(/6rem/);
  });
});

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
