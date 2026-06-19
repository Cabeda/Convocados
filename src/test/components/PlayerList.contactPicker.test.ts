import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { renderWithTheme } from "../render";
import { PlayerList } from "~/components/event/PlayerList";
import type { Player } from "~/components/event/types";

type PlayerSuggestion = {
  name: string;
  gamesPlayed: number;
  userId?: string | null;
};

expect.extend(jestDomMatchers);

vi.mock("~/lib/useT", () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    if (params) {
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
        key,
      );
    }
    return key;
  },
}));

const h: typeof React.createElement = React.createElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete (navigator as { contacts?: unknown }).contacts;
});

function mockContactPickerSupported() {
  const select = vi.fn().mockResolvedValue([{ name: ["Alex Smith"], email: ["alex@work.com", "alex@personal.com"] }]);
  (navigator as { contacts?: unknown }).contacts = { select };
  return select;
}

function mockContactPickerNoEmail() {
  const select = vi.fn().mockResolvedValue([{ name: ["Phone Only"], email: [] }]);
  (navigator as { contacts?: unknown }).contacts = { select };
  return select;
}

type PlayerListProps = React.ComponentProps<typeof PlayerList>;

const baseProps = (): PlayerListProps => ({
  players: [] as Player[],
  maxPlayers: 10,
  isOwner: true,
  hasTeams: false,
  availableSuggestions: [] as PlayerSuggestion[],
  playerError: null,
  onPlayerErrorChange: vi.fn(),
  onAddPlayer: vi.fn().mockResolvedValue(undefined),
  onRemovePlayer: vi.fn().mockResolvedValue(undefined),
  onReorderPlayers: vi.fn().mockResolvedValue(undefined),
  onResetPlayerOrder: vi.fn().mockResolvedValue(undefined),
  onRandomize: vi.fn(),
  onConfirmReRandomize: vi.fn(),
  canRemovePlayer: () => true,
});

function renderList(props: PlayerListProps) {
  return renderWithTheme(h(PlayerList, props));
}

describe("PlayerList — contact picker invite (Android parity)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders the unified name/email input field", () => {
    renderList(baseProps());
    expect(screen.getByPlaceholderText("addPlayerPlaceholder")).toBeInTheDocument();
  });

  it("renders the Contacts icon when navigator.contacts is supported", () => {
    mockContactPickerSupported();
    renderList(baseProps());
    expect(screen.getByTestId("pick-contact")).toBeInTheDocument();
  });

  it("does NOT render the Contacts icon when navigator.contacts is unsupported", () => {
    // Safari/Firefox: navigator.contacts is undefined
    renderList(baseProps());
    expect(screen.queryByTestId("pick-contact")).not.toBeInTheDocument();
  });

  it("auto-adds the picked contact with first email on tap (Android parity)", async () => {
    const select = mockContactPickerSupported();
    const onAddPlayer = vi.fn().mockResolvedValue(undefined);
    renderList({ ...baseProps(), onAddPlayer });

    fireEvent.click(screen.getByTestId("pick-contact"));

    await waitFor(() => expect(onAddPlayer).toHaveBeenCalledWith("Alex Smith", "alex@work.com"));
    expect(select).toHaveBeenCalledWith(["name", "email"], { multiple: false });
  });

  it("uses the first email when the contact has multiple (matches Android)", async () => {
    const select = mockContactPickerSupported();
    const onAddPlayer = vi.fn().mockResolvedValue(undefined);
    renderList({ ...baseProps(), onAddPlayer });

    fireEvent.click(screen.getByTestId("pick-contact"));

    await waitFor(() =>
      expect(onAddPlayer).toHaveBeenCalledWith("Alex Smith", "alex@work.com"),
    );
    // We must not have used the second email.
    expect(onAddPlayer).not.toHaveBeenCalledWith("Alex Smith", "alex@personal.com");
    expect(select).toHaveBeenCalled();
  });

  it("prefills the name field only when the picked contact has no email", async () => {
    mockContactPickerNoEmail();
    const onAddPlayer = vi.fn().mockResolvedValue(undefined);
    renderList({ ...baseProps(), onAddPlayer });

    fireEvent.click(screen.getByTestId("pick-contact"));

    await waitFor(() => {
      expect(screen.getByPlaceholderText("addPlayerPlaceholder")).toHaveValue("Phone Only");
    });
    expect(onAddPlayer).not.toHaveBeenCalled();
  });

  it("Add button is disabled when both name and email are empty", () => {
    mockContactPickerSupported();
    renderList(baseProps());
    const addBtn = screen.getByTestId("add-player-submit");
    expect(addBtn).toBeDisabled();
  });

  it("Add button is enabled when either name or email is non-empty", () => {
    mockContactPickerSupported();
    renderList(baseProps());
    const nameInput = screen.getByPlaceholderText("addPlayerPlaceholder");
    fireEvent.change(nameInput, { target: { value: "Mario" } });
    const addBtn = screen.getByTestId("add-player-submit");
    expect(addBtn).not.toBeDisabled();
  });

  it("Enter key submits with email detection when input is an email", () => {
    const onAddPlayer = vi.fn().mockResolvedValue(undefined);
    renderList({ ...baseProps(), onAddPlayer });
    const nameInput = screen.getByPlaceholderText("addPlayerPlaceholder");
    fireEvent.change(nameInput, { target: { value: "mario@x.com" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });
    expect(onAddPlayer).toHaveBeenCalledWith("mario", "mario@x.com");
  });
  // ── Quick Join pill removed (replaced by AttendanceCta in #XXX). Recent-players chips still
  //    render when the user is authenticated and idle. ───────────────────────────

  it("renders the recent-players chips when authenticated and idle", () => {
    renderList({
      ...baseProps(),
      availableSuggestions: [
        { name: "Bruno", gamesPlayed: 3, userId: null },
        { name: "Carla", gamesPlayed: 2, userId: "u-carla" },
      ] as PlayerSuggestion[],
    });
    expect(screen.getByText("Bruno")).toBeInTheDocument();
    expect(screen.getByText("Carla")).toBeInTheDocument();
  });

  it("hides the recent-players chips when the user is mid-typing", () => {
    renderList({
      ...baseProps(),
      availableSuggestions: [
        { name: "Bruno", gamesPlayed: 3, userId: null },
      ] as PlayerSuggestion[],
    });
    const nameInput = screen.getByPlaceholderText("addPlayerPlaceholder");
    fireEvent.change(nameInput, { target: { value: "M" } });
    expect(screen.queryByText("Bruno")).not.toBeInTheDocument();
  });
});
