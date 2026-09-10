import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
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
  sport = "football-5v5",
  canEdit = true,
  onResultChange,
}: {
  shuffleKey?: number;
  ratingsMap?: Record<string, number>;
  sport?: string;
  canEdit?: boolean;
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
      sport={sport}
      canEdit={canEdit}
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
    expect(red.players.map((p) => p.name)).toContain("Alice");
    expect(blue.players.map((p) => p.name)).toEqual(["Carol"]);
  });

  it("places a player into a specific slot when dropped on it", () => {
    const onResultChange = vi.fn();
    renderWithTheme(<TeamFieldHarness onResultChange={onResultChange} />);

    const targetSlot = screen.getByTestId("field-slot-Red-1");
    vi.spyOn(targetSlot, "getBoundingClientRect").mockReturnValue({
      left: 150, right: 160, top: 40, bottom: 50, width: 10, height: 10, x: 150, y: 40,
      toJSON: () => ({}),
    });

    fireEvent.pointerDown(screen.getByTestId("field-player-Alice"), {
      button: 0,
      pointerId: 1,
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerUp(screen.getByTestId("team-field"), {
      pointerId: 1,
      clientX: 155,
      clientY: 45,
    });

    const updated = onResultChange.mock.calls[0][0] as Imatch[];
    const red = updated.find((m) => m.team === "Red")!;
    expect(red.players.find((p) => p.name === "Alice")!.slot).toBe(1);
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

  it("does not move a player dropped outside every half", () => {
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
      clientX: 9999,
      clientY: 9999,
    });

    expect(onResultChange).not.toHaveBeenCalled();
  });

  it("renders a formation selector with the sport's options", () => {
    renderWithTheme(<TeamFieldHarness sport="football-5v5" />);

    const select = screen.getByTestId("field-formation-Blue");
    expect(select).toHaveTextContent("2-2");

    fireEvent.mouseDown(within(select).getByRole("combobox"));
    expect(screen.getByRole("option", { name: "1-2-1" })).toBeInTheDocument();
  });

  it("applies a new formation when one is chosen", () => {
    const onResultChange = vi.fn();
    renderWithTheme(<TeamFieldHarness onResultChange={onResultChange} />);

    const select = screen.getByTestId("field-formation-Blue");
    fireEvent.mouseDown(within(select).getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "1-2-1" }));

    expect(onResultChange).toHaveBeenCalledTimes(1);
    const updated = onResultChange.mock.calls[0][0] as Imatch[];
    expect(updated.find((m) => m.team === "Blue")!.formation).toBe("1-2-1");
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

  it("is read-only when the viewer cannot edit teams", () => {
    const onResultChange = vi.fn();
    renderWithTheme(<TeamFieldHarness canEdit={false} onResultChange={onResultChange} />);

    expect(screen.getByTestId("team-field")).toHaveAttribute("data-can-edit", "false");
    expect(within(screen.getByTestId("field-formation-Blue")).getByRole("combobox")).toHaveAttribute(
      "aria-disabled",
      "true",
    );

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

    expect(onResultChange).not.toHaveBeenCalled();
  });
});
