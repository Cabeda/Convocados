import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi, afterEach } from "vitest";
import { useState } from "react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { TeamField } from "~/components/TeamField";
import type { Imatch } from "~/lib/random";

const initialMatches: Imatch[] = [
  { team: "Blue", players: [{ name: "Alice", order: 0 }, { name: "Carol", order: 1 }] },
  { team: "Red", players: [{ name: "Bob", order: 0 }] },
];

function TeamFieldHarness({
  shuffleKey = 0,
  ratingsMap,
  onResultChange,
}: {
  shuffleKey?: number;
  ratingsMap?: Record<string, number>;
  onResultChange?: (m: Imatch[]) => void;
}) {
  const [matches, setMatches] = useState(initialMatches);
  return (
    <TeamField
      matches={matches}
      onResultChange={(m) => {
        setMatches(m);
        onResultChange?.(m);
      }}
      ratingsMap={ratingsMap}
      shuffleKey={shuffleKey}
    />
  );
}

function mockHalfRects() {
  const halves = screen.getAllByTestId("field-half");
  const blue = halves.find((h) => h.getAttribute("data-team") === "Blue")!;
  const red = halves.find((h) => h.getAttribute("data-team") === "Red")!;
  vi.spyOn(blue, "getBoundingClientRect").mockReturnValue({
    left: 0, right: 100, top: 0, bottom: 100, width: 100, height: 100, x: 0, y: 0,
    toJSON: () => ({}),
  });
  vi.spyOn(red, "getBoundingClientRect").mockReturnValue({
    left: 101, right: 200, top: 0, bottom: 100, width: 99, height: 100, x: 101, y: 0,
    toJSON: () => ({}),
  });
  return { blue, red };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("TeamField", () => {
  it("renders both halves with their players", () => {
    renderWithTheme(<TeamFieldHarness />);

    const halves = screen.getAllByTestId("field-half");
    expect(halves).toHaveLength(2);
    expect(halves.map((h) => h.getAttribute("data-team"))).toEqual(["Blue", "Red"]);

    expect(screen.getByTestId("field-player-Alice")).toBeInTheDocument();
    expect(screen.getByTestId("field-player-Carol")).toBeInTheDocument();
    expect(screen.getByTestId("field-player-Bob")).toBeInTheDocument();
  });

  it("moves a player to the other half when dragged across the field", () => {
    const onResultChange = vi.fn();
    renderWithTheme(<TeamFieldHarness onResultChange={onResultChange} />);
    mockHalfRects();

    fireEvent.pointerDown(screen.getByTestId("field-player-Alice"), {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(screen.getByTestId("team-field"), {
      pointerId: 1,
      clientX: 150,
      clientY: 50,
    });

    expect(onResultChange).toHaveBeenCalledTimes(1);
    const updated = onResultChange.mock.calls[0][0] as Imatch[];
    const red = updated.find((m) => m.team === "Red")!;
    const blue = updated.find((m) => m.team === "Blue")!;
    expect(red.players.map((p) => p.name)).toEqual(["Bob", "Alice"]);
    expect(blue.players.map((p) => p.name)).toEqual(["Carol"]);
  });

  it("does not move a player dropped back on their own half", () => {
    const onResultChange = vi.fn();
    renderWithTheme(<TeamFieldHarness onResultChange={onResultChange} />);
    mockHalfRects();

    fireEvent.pointerDown(screen.getByTestId("field-player-Alice"), {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(screen.getByTestId("team-field"), {
      pointerId: 1,
      clientX: 50,
      clientY: 50,
    });

    expect(onResultChange).not.toHaveBeenCalled();
  });

  it("exposes a transient shuffle state when the shuffle key changes", () => {
    vi.useFakeTimers();
    const { rerender } = renderWithTheme(<TeamFieldHarness shuffleKey={0} />);

    rerender(<TeamFieldHarness shuffleKey={1} />);
    expect(screen.getByTestId("team-field")).toHaveAttribute("data-shuffling", "true");

    act(() => vi.advanceTimersByTime(700));
    expect(screen.getByTestId("team-field")).toHaveAttribute("data-shuffling", "false");
  });

  it("shows the average Elo per team when ratings are available", () => {
    renderWithTheme(
      <TeamFieldHarness ratingsMap={{ Alice: 1200, Carol: 1000, Bob: 800 }} />,
    );

    expect(screen.getByTestId("field-half-elo-Blue")).toHaveTextContent("Elo 1100");
    expect(screen.getByTestId("field-half-elo-Red")).toHaveTextContent("Elo 800");
  });
});
