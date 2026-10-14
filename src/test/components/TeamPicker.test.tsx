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

function TeamPickerHarness({ shuffleKey = 0, canEdit = true, onResultChange }: { shuffleKey?: number; canEdit?: boolean; onResultChange?: (m: Imatch[]) => void }) {
  const [matches, setMatches] = useState(initialMatches);
  return (
    <TeamPicker
      matches={matches}
      onResultChange={(m) => { setMatches(m); onResultChange?.(m); }}
      shuffleKey={shuffleKey}
      canEdit={canEdit}
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

  it("does not move players when read-only", () => {
    const onResultChange = vi.fn();
    renderWithTheme(<TeamPickerHarness canEdit={false} onResultChange={onResultChange} />);

    expect(screen.getByTestId("team-picker")).toHaveAttribute("data-can-edit", "false");

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

    expect(onResultChange).not.toHaveBeenCalled();
  });
});

describe("TeamPicker stakes integration", () => {
  it("shows Crew association and projected points per player and per side", () => {
    renderWithTheme(
      <TeamPicker
        matches={initialMatches}
        onResultChange={() => {}}
        viewerName="Alice"
        crewMap={{ Alice: { crewId: "c1", crewName: "Sharks" }, Bob: null }}
        stakeMap={{
          Alice: { contribution: 3, rpDelta: 12, passed: 1, provisional: false },
          Bob: { contribution: 0, rpDelta: -8, passed: -1, provisional: false },
        }}
        crewChipsByTeamIndex={[[{ crewId: "c1", name: "Sharks", roundScore: 3, positionAfter: 1, passed: 1 }], []]}
      />,
    );

    expect(screen.getByTestId("team-player-crew-Alice")).toHaveTextContent("Sharks");
    expect(screen.getByTestId("team-player-points-Alice")).toHaveTextContent("3 pts");
    expect(screen.getByTestId("team-player-rank-Alice")).toHaveTextContent("+12 RP");
    // Rank movement is the viewer's own — another player's is never shown.
    expect(screen.getByTestId("team-player-points-Bob")).toHaveTextContent("0 pts");
    expect(screen.queryByTestId("team-player-rank-Bob")).not.toBeInTheDocument();
    // A Season participant without a Crew reads as a free agent.
    expect(screen.getByText("Free agent")).toBeInTheDocument();
    // The side header carries that side's Crew projection.
    expect(screen.getByTestId("team-crew-chip-c1")).toHaveTextContent("Sharks");
    expect(screen.getByTestId("team-crew-chip-c1")).toHaveTextContent("#1");
  });

  it("renders no stake chips without the props", () => {
    renderWithTheme(<TeamPicker matches={initialMatches} onResultChange={() => {}} />);
    expect(screen.queryByTestId("team-player-crew-Alice")).not.toBeInTheDocument();
    expect(screen.queryByText("Free agent")).not.toBeInTheDocument();
  });
});
