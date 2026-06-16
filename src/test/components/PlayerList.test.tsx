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
    // Dialog is rendered by EventPage, not PlayerList. The component
    // dispatches an intent via onRequestAdd; we assert the dispatch.
    expect(baseProps.onRequestAdd).toHaveBeenCalledWith({
      kind: "single",
      name: "Charlie",
      email: undefined,
      source: "chip",
    });
    expect(baseProps.onAddPlayer).not.toHaveBeenCalled();
  });

  it("dispatches intent with email footnote when invite email is set", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} inviteEmail="alice@example.com" />);
    const chip = screen.getByText("Dana");
    await user.click(chip);
    expect(baseProps.onRequestAdd).toHaveBeenCalledWith({
      kind: "single",
      name: "Dana",
      email: "alice@example.com",
      source: "chip",
    });
  });

  it("dispatches intent with source=dropdown when an Autocomplete option is selected", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} />);
    const input = screen.getByPlaceholderText(/add player name/i);
    await user.click(input);
    await user.type(input, "Char");
    // The Autocomplete renders options in a portal/listbox.
    const option = await screen.findByRole("option", { name: /Charlie/ });
    await user.click(option);
    expect(baseProps.onRequestAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Charlie", source: "dropdown" }),
    );
  });

  it("does NOT open the dialog when Enter is pressed on a typed name (typing is deliberate)", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} />);
    const input = screen.getByPlaceholderText(/add player name/i);
    await user.click(input);
    await user.type(input, "NewName{Enter}");
    expect(baseProps.onAddPlayer).toHaveBeenCalledWith("NewName", undefined);
    expect(baseProps.onRequestAdd).not.toHaveBeenCalled();
  });

  it("does NOT open the dialog when the + IconButton is tapped (typing is deliberate)", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} />);
    const input = screen.getByPlaceholderText(/add player name/i);
    await user.type(input, "AnotherName");
    const buttons = screen.getAllByRole("button");
    // The + IconButton in the input's end adornment
    const addButton = buttons.find((b) => b.querySelector('[data-testid="PersonAddIcon"]') !== null) ?? buttons[buttons.length - 1];
    await user.click(addButton);
    expect(baseProps.onAddPlayer).toHaveBeenCalledWith("AnotherName", undefined);
    expect(baseProps.onRequestAdd).not.toHaveBeenCalled();
  });

  it("does NOT trigger a bulk paste — pastes are no longer parsed as multi-line", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} />);
    const input = screen.getByPlaceholderText(/add player name/i);
    await user.click(input);
    // Simulate a paste of multiple lines
    const dt = { getData: () => "Alice\nBob\nCarol" };
    fireEvent.paste(input, { clipboardData: dt });
    // Bulk handler is removed — no onAddPlayer for any of the names.
    expect(baseProps.onAddPlayer).not.toHaveBeenCalled();
    expect(baseProps.onRequestAdd).not.toHaveBeenCalled();
  });

  it("forwards inviteEmail changes to the parent via onInviteEmailChange", async () => {
    const onChange = vi.fn();
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} onInviteEmailChange={onChange} />);
    const emailInput = screen.getByPlaceholderText(/invite by email/i);
    await user.type(emailInput, "x@y.z");
    expect(onChange).toHaveBeenCalled();
    // Last call is the final value
    expect(onChange.mock.calls.at(-1)?.[0]).toBe("x@y.z");
  });
});
