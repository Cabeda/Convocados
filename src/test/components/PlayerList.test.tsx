import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PlayerList } from "~/components/event/PlayerList";
import type { Player } from "~/components/event/types";

afterEach(() => cleanup());

const basePlayers: Player[] = [
  { id: "p1", name: "Alice", userId: null },
  { id: "p2", name: "Bob", userId: null },
];

const baseSuggestions = [
  { name: "Charlie", gamesPlayed: 5, userId: null },
  { name: "Dana", gamesPlayed: 3, userId: null },
];

const baseProps = {
  players: basePlayers,
  maxPlayers: 10,
  isOwner: true,
  hasTeams: false,
  availableSuggestions: baseSuggestions,
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

beforeEach(() => {
  Object.values(baseProps).forEach((v) => {
    if (typeof v === "function" && "mockClear" in v) (v as any).mockClear();
  });
});

describe("PlayerList — confirmation dialog trigger", () => {
  it("opens the dialog when a recent-players Chip is clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} />);
    const chip = screen.getByText("Charlie");
    await user.click(chip);
    expect(baseProps.onRequestAdd).toHaveBeenCalledWith({
      kind: "single",
      name: "Charlie",
      email: undefined,
      source: "chip",
    });
    expect(baseProps.onAddPlayer).not.toHaveBeenCalled();
  });

  it("dispatches intent with source=dropdown when an Autocomplete option is selected", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} />);
    const input = screen.getByPlaceholderText(/add player/i);
    await user.click(input);
    await user.type(input, "Char");
    const option = await screen.findByRole("option", { name: /Charlie/ });
    await user.click(option);
    expect(baseProps.onRequestAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Charlie", source: "dropdown" }),
    );
  });

  it("does NOT open the dialog when Enter is pressed on a typed name (typing is deliberate)", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} />);
    const input = screen.getByPlaceholderText(/add player/i);
    await user.click(input);
    await user.type(input, "NewName{Enter}");
    expect(baseProps.onAddPlayer).toHaveBeenCalledWith("NewName");
    expect(baseProps.onRequestAdd).not.toHaveBeenCalled();
  });

  it("does NOT open the dialog when the + IconButton is tapped (typing is deliberate)", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} />);
    const input = screen.getByPlaceholderText(/add player/i);
    await user.type(input, "AnotherName");
    const buttons = screen.getAllByRole("button");
    const addButton = buttons.find((b) => b.getAttribute("data-testid") === "add-player-submit")
      ?? buttons.find((b) => b.querySelector('[data-testid="PersonAddIcon"]') !== null);
    if (!addButton) throw new Error("+ IconButton not found");
    fireEvent.click(addButton);
    expect(baseProps.onAddPlayer).toHaveBeenCalled();
    expect(baseProps.onRequestAdd).not.toHaveBeenCalled();
  });

  it("falls back to onAddPlayer when no onRequestAdd is provided (e.g. older API surface)", async () => {
    const user = userEvent.setup();
    const fallbackProps = { ...baseProps, onRequestAdd: undefined };
    renderWithTheme(<PlayerList {...fallbackProps} />);
    const chip = screen.getByText("Charlie");
    await user.click(chip);
    expect(baseProps.onAddPlayer).toHaveBeenCalledWith("Charlie");
  });
});
