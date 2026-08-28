import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { TeamPicker } from "~/components/TeamPicker";
import type { Imatch } from "~/lib/random";

const initialMatches: Imatch[] = [
  { team: "Blue", players: [{ name: "Alice", order: 0 }] },
  { team: "Red", players: [{ name: "Bob", order: 0 }] },
];

function TeamPickerHarness({ shuffleKey = 0 }: { shuffleKey?: number }) {
  const [matches, setMatches] = useState(initialMatches);
  return (
    <TeamPicker
      matches={matches}
      onResultChange={setMatches}
      shuffleKey={shuffleKey}
    />
  );
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TeamPicker motion", () => {
  it("marks a player as arriving when dropped on another team", () => {
    renderWithTheme(<TeamPickerHarness />);

    const panels = screen.getAllByTestId("team-panel");
    vi.spyOn(panels[0], "getBoundingClientRect").mockReturnValue({
      left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100, x: 0, y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(panels[1], "getBoundingClientRect").mockReturnValue({
      left: 101, right: 200, top: 0, bottom: 100, width: 99, height: 100, x: 101, y: 0,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(screen.getByTestId("team-player-handle-Alice"), {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(screen.getByTestId("team-picker"), {
      pointerId: 1,
      clientX: 150,
      clientY: 50,
    });

    expect(screen.getByTestId("team-player-Alice")).toHaveAttribute("data-motion", "arriving");
    const destinationPanel = screen.getAllByTestId("team-panel").find(
      (panel) => panel.getAttribute("data-team") === "Red",
    );
    expect(destinationPanel).toHaveAttribute("data-motion", "destination");
  });

  it("exposes a transient shuffle state when the shuffle key changes", () => {
    vi.useFakeTimers();
    const { rerender } = renderWithTheme(<TeamPickerHarness shuffleKey={0} />);

    rerender(<TeamPickerHarness shuffleKey={1} />);
    expect(screen.getByTestId("team-picker")).toHaveAttribute("data-shuffling", "true");

    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByTestId("team-picker")).toHaveAttribute("data-shuffling", "false");
  });
});
