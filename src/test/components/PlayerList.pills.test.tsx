/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PlayerList } from "~/components/event/PlayerList";

const { mediaQueryState } = vi.hoisted(() => ({ mediaQueryState: { matches: false } }));
vi.mock("@mui/material", async (importOriginal) => {
  const mod = await importOriginal();
  return { ...mod, useMediaQuery: () => mediaQueryState.matches };
});

afterEach(() => {
  cleanup();
  mediaQueryState.matches = false;
});

const baseProps = {
  players: [{ id: "p1", name: "Alice", userId: null }],
  maxPlayers: 10,
  isOwner: true,
  hasTeams: false,
  availableSuggestions: [],
  playerError: null as string | null,
  onPlayerErrorChange: vi.fn(),
  onAddPlayer: vi.fn().mockResolvedValue(undefined),
  onRequestAdd: vi.fn(),
  onRemovePlayer: vi.fn().mockResolvedValue(undefined),
  onReorderPlayers: vi.fn().mockResolvedValue(undefined),
  onResetPlayerOrder: vi.fn().mockResolvedValue(undefined),
  onRandomize: vi.fn(),
  onConfirmReRandomize: vi.fn(),
  canRemovePlayer: () => true,
};

function pills(n: number) {
  return Array.from({ length: n }, (_, i) => ({ name: `Player ${i}`, userId: `u-${i}` }));
}

describe("PlayerList — suggestion pills expander", () => {
  it("shows at most 8 pills with a show-more toggle when collapsed", () => {
    renderWithTheme(<PlayerList {...baseProps} coPlaySuggestions={pills(10)} />);
    for (let i = 0; i < 8; i++) expect(screen.getByTestId(`suggest-chip-u-${i}`)).toBeTruthy();
    expect(screen.queryByTestId("suggest-chip-u-8")).toBeNull();
    expect(screen.getByRole("button", { name: /show more suggestions/i })).toBeTruthy();
  });

  it("reveals all pills and toggles back via show-fewer", () => {
    renderWithTheme(<PlayerList {...baseProps} coPlaySuggestions={pills(10)} />);
    fireEvent.click(screen.getByRole("button", { name: /show more suggestions/i }));
    expect(screen.getByTestId("suggest-chip-u-9")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /show fewer suggestions/i }));
    expect(screen.queryByTestId("suggest-chip-u-8")).toBeNull();
  });

  it("renders no toggle when pills fit the collapsed count", () => {
    renderWithTheme(<PlayerList {...baseProps} coPlaySuggestions={pills(8)} />);
    expect(screen.queryByRole("button", { name: /show more suggestions/i })).toBeNull();
    expect(screen.getByTestId("suggest-chip-u-7")).toBeTruthy();
  });

  it("dispatches add intent with source=chip for fallback (anonymous) pills", () => {
    const onRequestAdd = vi.fn();
    renderWithTheme(
      <PlayerList {...baseProps} onRequestAdd={onRequestAdd} coPlaySuggestions={[{ name: "Guest", userId: null }]} />,
    );
    fireEvent.click(screen.getByTestId("suggest-chip-name:Guest"));
    expect(onRequestAdd).toHaveBeenCalledWith({ kind: "single", name: "Guest", userId: undefined, source: "chip" });
  });
});
