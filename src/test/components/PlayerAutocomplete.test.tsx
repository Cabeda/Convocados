/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { useState } from "react";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PlayerAutocomplete } from "~/components/event/PlayerAutocomplete";

afterEach(() => cleanup());

const suggestions = [
  { name: "Alice", gamesPlayed: 5, userId: null },
  { name: "Bob", gamesPlayed: 3, userId: null },
];

interface HarnessProps {
  onAdd: (name: string) => void;
  onRequestAdd: (intent: { kind: "single"; name: string; email?: string; userId?: string; source: "chip" | "dropdown" | "input" }) => void;
  withRequestAdd?: boolean;
}

function Harness({ onAdd, onRequestAdd, withRequestAdd = true }: HarnessProps) {
  const [value, setValue] = useState("");
  return (
    <PlayerAutocomplete
      value={value}
      onChange={setValue}
      onAdd={onAdd}
      {...(withRequestAdd ? { onRequestAdd } : {})}
      suggestions={suggestions}
    />
  );
}

describe("PlayerAutocomplete — confirmation dialog trigger", () => {
  it("calls onRequestAdd when an Autocomplete option is selected (dropdown tap)", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const onRequestAdd = vi.fn();
    renderWithTheme(<Harness onAdd={onAdd} onRequestAdd={onRequestAdd} />);
    const input = screen.getByPlaceholderText(/add player name/i);
    await user.click(input);
    await user.type(input, "Ali");
    const option = await screen.findByRole("option", { name: /Alice/ });
    await user.click(option);
    expect(onRequestAdd).toHaveBeenCalledWith({
      kind: "single",
      name: "Alice",
      source: "dropdown",
    });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("calls onAdd (direct) when Enter is pressed on a freeSolo new name", async () => {
    const onAdd = vi.fn();
    const onRequestAdd = vi.fn();
    renderWithTheme(<Harness onAdd={onAdd} onRequestAdd={onRequestAdd} />);
    const input = screen.getByPlaceholderText(/add player name/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Newcomer" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onAdd).toHaveBeenCalledWith("Newcomer");
    expect(onRequestAdd).not.toHaveBeenCalled();
  });

  it("calls onAdd (direct) when the + IconButton is tapped", async () => {
    const onAdd = vi.fn();
    const onRequestAdd = vi.fn();
    renderWithTheme(<Harness onAdd={onAdd} onRequestAdd={onRequestAdd} />);
    const input = screen.getByPlaceholderText(/add player name/i);
    fireEvent.change(input, { target: { value: "Somebody" } });
    // The + IconButton is inside the Autocomplete's endAdornment.
    // We grab the input's parent and find the closest button.
    const allButtons = screen.getAllByRole("button");
    // The + IconButton is the small PersonAdd icon-button.
    const addButton = allButtons.find((b) => b.classList.contains("MuiIconButton-colorPrimary"));
    if (!addButton) throw new Error("+ IconButton not found");
    fireEvent.click(addButton);
    expect(onAdd).toHaveBeenCalledWith("Somebody");
    expect(onRequestAdd).not.toHaveBeenCalled();
  });

  it("falls back to onAdd when no onRequestAdd is provided (e.g. historical game dialogs)", async () => {
    const onAdd = vi.fn();
    const onRequestAdd = vi.fn();
    renderWithTheme(<Harness onAdd={onAdd} onRequestAdd={onRequestAdd} withRequestAdd={false} />);
    const input = screen.getByPlaceholderText(/add player name/i);
    fireEvent.change(input, { target: { value: "Alice" } });
    // The Autocomplete dropdown is filtered by value; with the value set, the
    // option should be visible in the listbox. We trigger the onChange via
    // the option's click.
    const option = await screen.findByRole("option", { name: /Alice/ });
    fireEvent.click(option);
    expect(onAdd).toHaveBeenCalledWith("Alice");
  });
});

describe("PlayerAutocomplete — password manager suppression", () => {
  it("marks the input so password managers do not offer/save credentials", () => {
    const onAdd = vi.fn();
    renderWithTheme(<Harness onAdd={onAdd} onRequestAdd={vi.fn()} />);
    const input = screen.getByPlaceholderText(/add player name/i) as HTMLInputElement;
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("name", "player-name");
    // Vendor-specific ignore hints: 1Password, LastPass, Dashlane/Bitwarden heuristics
    expect(input).toHaveAttribute("data-1p-ignore", "true");
    expect(input).toHaveAttribute("data-lpignore", "true");
    expect(input).toHaveAttribute("data-form-type", "other");
  });
});

describe("PlayerAutocomplete — player identity (avatar / anonymous icon)", () => {
  interface IdentityHarnessProps {
    onAdd: (name: string) => void;
    suggestions: { name: string; gamesPlayed: number; userId?: string | null; image?: string | null }[];
  }
  function IdentityHarness({ onAdd, suggestions }: IdentityHarnessProps) {
    const [value, setValue] = useState("");
    return <PlayerAutocomplete value={value} onChange={setValue} onAdd={onAdd} suggestions={suggestions} />;
  }

  it("renders the profile avatar for a linked suggestion and the anonymous icon for a guest", async () => {
    const user = userEvent.setup();
    const onAdd = vi.fn();
    const suggestions = [
      { name: "Linked", gamesPlayed: 2, userId: "u-x", image: "https://example.com/linked.jpg" },
      { name: "Anon", gamesPlayed: 1, userId: null, image: null },
    ];
    renderWithTheme(<IdentityHarness onAdd={onAdd} suggestions={suggestions} />);
    const input = screen.getByPlaceholderText(/add player name/i);
    await user.click(input);
    await user.type(input, "Lin");
    const option = await screen.findByRole("option", { name: /Linked/ });
    expect(option.querySelector("img")).toHaveAttribute("src", "https://example.com/linked.jpg");
    await user.clear(input);
    await user.type(input, "Anon");
    const anonOption = await screen.findByRole("option", { name: /Anon/ });
    expect(anonOption.querySelector('[data-testid="Person2OutlinedIcon"]')).not.toBeNull();
  });
});
