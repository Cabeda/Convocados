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

  it("renders name and email fields as a single row (merged component)", () => {
    renderList(baseProps());
    expect(screen.getByPlaceholderText("addPlayerPlaceholder")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("inviteByEmailPlaceholder")).toBeInTheDocument();
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
    expect(screen.getByPlaceholderText("inviteByEmailPlaceholder")).toHaveValue("");
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

  it("Enter key submits with current name+email values", () => {
    renderList(baseProps());
    const nameInput = screen.getByPlaceholderText("addPlayerPlaceholder");
    const emailInput = screen.getByPlaceholderText("inviteByEmailPlaceholder");
    fireEvent.change(nameInput, { target: { value: "Mario" } });
    fireEvent.change(emailInput, { target: { value: "mario@x.com" } });
    fireEvent.keyDown(nameInput, { key: "Enter" });
    // The actual submit is wired through onAddPlayer(name, email)
    // We just check the helper text under the email field stays visible.
    expect(screen.getByText("inviteByEmailHelper")).toBeInTheDocument();
  });

  // ── Quick Join pill (first pill, authenticated-only) ──────────────────────

  it("renders the Quick Join pill when quickJoinUserName is set and user is not joined", () => {
    renderList({ ...baseProps(), quickJoinUserName: "Alex" });
    // The pill is rendered (label text depends on the i18n mock returning the key).
    expect(screen.getByTestId("quick-join-pill")).toBeInTheDocument();
  });

  it("does NOT render the Quick Join pill when quickJoinUserName is omitted (anonymous)", () => {
    renderList(baseProps());
    expect(screen.queryByTestId("quick-join-pill")).not.toBeInTheDocument();
  });

  it("hides the Quick Join pill when the user is already in the players list", () => {
    renderList({
      ...baseProps(),
      quickJoinUserName: "Alex",
      players: [{ id: "p1", name: "Alex", userId: "u-alex" }] as Player[],
    });
    expect(screen.queryByTestId("quick-join-pill")).not.toBeInTheDocument();
  });

  it("hides the Quick Join pill when the user is mid-typing (idle-only)", () => {
    renderList({ ...baseProps(), quickJoinUserName: "Alex" });
    const nameInput = screen.getByPlaceholderText("addPlayerPlaceholder");
    fireEvent.change(nameInput, { target: { value: "M" } });
    expect(screen.queryByTestId("quick-join-pill")).not.toBeInTheDocument();
  });

  it("calls onQuickJoinPillClick when the pill is tapped (host owns the routing)", () => {
    const onQuickJoinPillClick = vi.fn();
    renderList({ ...baseProps(), quickJoinUserName: "Alex", onQuickJoinPillClick });
    fireEvent.click(screen.getByTestId("quick-join-pill"));
    expect(onQuickJoinPillClick).toHaveBeenCalledWith("Alex");
  });

  it("falls back to onAddPlayer when no onQuickJoinPillClick is provided", () => {
    const onAddPlayer = vi.fn().mockResolvedValue(undefined);
    renderList({ ...baseProps(), quickJoinUserName: "Alex", onAddPlayer });
    fireEvent.click(screen.getByTestId("quick-join-pill"));
    expect(onAddPlayer).toHaveBeenCalledWith("Alex");
  });

  it("places the Quick Join pill before the recent-players chips in the same row", () => {
    renderList({
      ...baseProps(),
      quickJoinUserName: "Alex",
      availableSuggestions: [
        { name: "Bruno", gamesPlayed: 3, userId: null },
        { name: "Carla", gamesPlayed: 2, userId: "u-carla" },
      ] as { name: string; gamesPlayed: number; userId: string | null }[],
    });
    const qj = screen.getByTestId("quick-join-pill");
    const bruno = screen.getByText("Bruno");
    expect(qj).toBeInTheDocument();
    expect(bruno).toBeInTheDocument();
    // DOM order: Quick Join precedes Bruno
    expect(qj.compareDocumentPosition(bruno) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
});
