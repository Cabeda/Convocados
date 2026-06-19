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

describe("PlayerList — attendance UI (You row + guest pill)", () => {
  const linkedPlayer: Player = { id: "p-linked", name: "LinkedAlice", userId: "u-1" };
  const guestPlayer: Player = { id: "p-guest", name: "GuestBob", userId: null };

  const onSetMyRsvp = vi.fn().mockResolvedValue(undefined);
  const onSetGuestRsvp = vi.fn().mockResolvedValue(undefined);
  const onRemovePlayer = vi.fn().mockResolvedValue(undefined);
  const onJoinAsSelf = vi.fn();

  const attendanceBase = {
    players: [linkedPlayer, guestPlayer],
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
    onSetMyRsvp,
    onSetGuestRsvp,
    onJoinAsSelf,
  };

  beforeEach(() => {
    onSetMyRsvp.mockClear();
    onSetGuestRsvp.mockClear();
    onRemovePlayer.mockClear();
    onJoinAsSelf.mockClear();
  });

  it("does not render the AttendanceCta when currentUserId is null (anonymous)", () => {
    renderWithTheme(
      <PlayerList {...attendanceBase} currentUserId={null} myRsvpStatus={null} guestRsvpMap={{}} />,
    );
    expect(screen.queryByTestId("attendance-cta")).toBeNull();
  });

  it("renders the AttendanceCta when the current user is on the list", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus={null}
        guestRsvpMap={{}}
      />,
    );
    expect(screen.getByTestId("attendance-cta")).toBeInTheDocument();
    expect(screen.getByTestId("attendance-cta-going")).toBeInTheDocument();
    expect(screen.getByTestId("attendance-cta-not-coming")).toBeInTheDocument();
  });

  it("renders the AttendanceCta for a follower-only user (with 'Join this game' copy on Going)", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-someone-else"
        myRsvpStatus={null}
        guestRsvpMap={{}}
      />,
    );
    expect(screen.getByTestId("attendance-cta")).toBeInTheDocument();
    // Going button is labeled "Join this game" when the user isn't on the list.
    expect(screen.getByTestId("attendance-cta-going")).toHaveTextContent(/join/i);
  });

  it("calls onSetMyRsvp('yes') when the Going button is clicked and the user IS on the list", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus={null}
        guestRsvpMap={{}}
      />,
    );
    await user.click(screen.getByTestId("attendance-cta-going"));
    expect(attendanceBase.onSetMyRsvp).toHaveBeenCalledWith("yes");
    expect(attendanceBase.onJoinAsSelf).not.toHaveBeenCalled();
  });

  it("calls onJoinAsSelf when the Going button is clicked and the user is NOT on the list", async () => {
    const user = userEvent.setup();
    const onJoinAsSelf = vi.fn();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-someone-else"
        myRsvpStatus={null}
        guestRsvpMap={{}}
        onJoinAsSelf={onJoinAsSelf}
      />,
    );
    await user.click(screen.getByTestId("attendance-cta-going"));
    expect(onJoinAsSelf).toHaveBeenCalledTimes(1);
    expect(attendanceBase.onSetMyRsvp).not.toHaveBeenCalled();
  });

  it("does NOT open the confirm dialog when no warning applies (event > 48h away) — one-click Not coming", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus="yes"
        guestRsvpMap={{}}
        eventDateTime={new Date(Date.now() + 7 * 86400_000).toISOString()}
      />,
    );
    await user.click(screen.getByTestId("attendance-cta-not-coming"));
    // No dialog, just the immediate leave.
    expect(screen.queryByTestId("leave-dialog-confirm")).toBeNull();
    expect(attendanceBase.onSetMyRsvp).toHaveBeenCalledWith("no");
  });

  it("does NOT open the confirm dialog when no warning applies (bench has players) — one-click Not coming", async () => {
    const user = userEvent.setup();
    // Add 3 more players so the bench is not empty after Alice leaves.
    const players = [
      { id: "p-linked", name: "LinkedAlice", userId: "u-1" },
      { id: "p-guest", name: "GuestBob", userId: null },
      { id: "p2", name: "P2", userId: null },
      { id: "p3", name: "P3", userId: null },
      { id: "p4", name: "P4", userId: null },
      { id: "p5", name: "P5", userId: null }, // bench
    ];
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        players={players}
        maxPlayers={5}
        currentUserId="u-1"
        myRsvpStatus="yes"
        guestRsvpMap={{}}
        eventDateTime={new Date(Date.now() + 12 * 3600_000).toISOString()} // 12h
      />,
    );
    await user.click(screen.getByTestId("attendance-cta-not-coming"));
    // Within 48h but bench has a player → no warning → one-click.
    expect(screen.queryByTestId("leave-dialog-confirm")).toBeNull();
    expect(attendanceBase.onSetMyRsvp).toHaveBeenCalledWith("no");
  });

  it("opens the confirm dialog when the warning applies (within 48h + bench empty)", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus="yes"
        guestRsvpMap={{}}
        eventDateTime={new Date(Date.now() + 12 * 3600_000).toISOString()} // 12h
      />,
    );
    await user.click(screen.getByTestId("attendance-cta-not-coming"));
    expect(await screen.findByTestId("leave-dialog-confirm")).toBeInTheDocument();
    expect(attendanceBase.onSetMyRsvp).not.toHaveBeenCalled();
  });

  it("calls onSetMyRsvp('no') after the user confirms the leave dialog", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus="yes"
        guestRsvpMap={{}}
        eventDateTime={new Date(Date.now() + 12 * 3600_000).toISOString()} // 12h — triggers dialog
      />,
    );
    await user.click(screen.getByTestId("attendance-cta-not-coming"));
    await user.click(await screen.findByTestId("leave-dialog-confirm"));
    expect(attendanceBase.onSetMyRsvp).toHaveBeenCalledWith("no");
  });

  it("calls onSetMyRsvp('no') when the Not Coming button is clicked and the user is NOT on the list (just records, no leave)", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-someone-else"
        myRsvpStatus={null}
        guestRsvpMap={{}}
      />,
    );
    await user.click(screen.getByTestId("attendance-cta-not-coming"));
    expect(attendanceBase.onSetMyRsvp).toHaveBeenCalledWith("no");
  });

  it("disables the Going button when the user is already 'yes'", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus="yes"
        guestRsvpMap={{}}
      />,
    );
    expect(screen.getByTestId("attendance-cta-going")).toBeDisabled();
    expect(screen.getByTestId("attendance-cta-not-coming")).not.toBeDisabled();
  });

  it("disables neither button when the user has not responded yet", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus={null}
        guestRsvpMap={{}}
      />,
    );
    expect(screen.getByTestId("attendance-cta-going")).not.toBeDisabled();
    expect(screen.getByTestId("attendance-cta-not-coming")).not.toBeDisabled();
  });

  it("does not render a guest pill on linked (userId set) rows", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId={null}
        myRsvpStatus={null}
        guestRsvpMap={{ [guestPlayer.id]: "yes" }}
      />,
    );
    expect(screen.queryByTestId(`rsvp-guest-pill-${linkedPlayer.id}`)).toBeNull();
    expect(screen.getByTestId(`rsvp-guest-pill-${guestPlayer.id}`)).toBeInTheDocument();
  });

  it("renders the guest pill as a non-interactive Chip when canEditGuestAttendance is false (anon viewer)", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId={null}
        myRsvpStatus={null}
        guestRsvpMap={{ [guestPlayer.id]: "yes" }}
        canEditGuestAttendance={false}
      />,
    );
    const pill = screen.getByTestId(`rsvp-guest-pill-${guestPlayer.id}`);
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute("data-status", "yes");
  });

  it("opens the menu when admin clicks the guest pill, with all 3 status options", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId={null}
        myRsvpStatus={null}
        guestRsvpMap={{ [guestPlayer.id]: null }}
        canEditGuestAttendance
      />,
    );
    await user.click(screen.getByTestId(`rsvp-guest-pill-${guestPlayer.id}`));
    // Menu opens with 3 status options
    expect(await screen.findByTestId(`rsvp-guest-menu-going-${guestPlayer.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`rsvp-guest-menu-declined-${guestPlayer.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`rsvp-guest-menu-noresponse-${guestPlayer.id}`)).toBeInTheDocument();
    // No "clear" option when status is null
    expect(screen.queryByTestId(`rsvp-guest-menu-clear-${guestPlayer.id}`)).toBeNull();
  });

  it("calls onSetGuestRsvp(yes) when the 'Going' menu option is clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId={null}
        myRsvpStatus={null}
        guestRsvpMap={{ [guestPlayer.id]: null }}
        canEditGuestAttendance
      />,
    );
    await user.click(screen.getByTestId(`rsvp-guest-pill-${guestPlayer.id}`));
    await user.click(await screen.findByTestId(`rsvp-guest-menu-going-${guestPlayer.id}`));
    expect(attendanceBase.onSetGuestRsvp).toHaveBeenCalledWith(guestPlayer.id, "yes");
  });

  it("opens the confirm dialog when the 'Declined' menu option is clicked (admin declines a guest)", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId={null}
        myRsvpStatus={null}
        guestRsvpMap={{ [guestPlayer.id]: "yes" }}
        canEditGuestAttendance
        eventDateTime={new Date(Date.now() + 7 * 86400_000).toISOString()}
      />,
    );
    await user.click(screen.getByTestId(`rsvp-guest-pill-${guestPlayer.id}`));
    await user.click(screen.getByTestId(`rsvp-guest-menu-declined-${guestPlayer.id}`));
    // Confirm dialog opens (not a direct call to onSetGuestRsvp).
    expect(await screen.findByTestId("leave-dialog-confirm")).toBeInTheDocument();
    expect(attendanceBase.onSetGuestRsvp).not.toHaveBeenCalled();
  });

  it("shows a 'Clear attendance' option when the current status is not null", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId={null}
        myRsvpStatus={null}
        guestRsvpMap={{ [guestPlayer.id]: "yes" }}
        canEditGuestAttendance
      />,
    );
    await user.click(screen.getByTestId(`rsvp-guest-pill-${guestPlayer.id}`));
    expect(await screen.findByTestId(`rsvp-guest-menu-clear-${guestPlayer.id}`)).toBeInTheDocument();
  });

  it("calls onSetGuestRsvp(null) when the 'Clear' menu option is clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId={null}
        myRsvpStatus={null}
        guestRsvpMap={{ [guestPlayer.id]: "no" }}
        canEditGuestAttendance
      />,
    );
    await user.click(screen.getByTestId(`rsvp-guest-pill-${guestPlayer.id}`));
    await user.click(await screen.findByTestId(`rsvp-guest-menu-clear-${guestPlayer.id}`));
    expect(attendanceBase.onSetGuestRsvp).toHaveBeenCalledWith(guestPlayer.id, null);
  });

  it("does not let an anonymous viewer click the pill (outlined, non-interactive)", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId={null}
        myRsvpStatus={null}
        guestRsvpMap={{ [guestPlayer.id]: "yes" }}
        canEditGuestAttendance={false}
      />,
    );
    const pill = screen.getByTestId(`rsvp-guest-pill-${guestPlayer.id}`);
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute("data-status", "yes");
    // The pill is rendered as the outlined (read-only) variant when canEditGuestAttendance is false.
    expect(pill.className).toMatch(/MuiChip-outlined/);
  });

  it("renders the pill in the filled variant for the admin (clickable)", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId={null}
        myRsvpStatus={null}
        guestRsvpMap={{ [guestPlayer.id]: "yes" }}
        canEditGuestAttendance
      />,
    );
    const pill = screen.getByTestId(`rsvp-guest-pill-${guestPlayer.id}`);
    expect(pill.className).toMatch(/MuiChip-filled/);
  });

  // #XXX AttendanceCard was removed (#XXX simplification). The AttendanceCta + guest pills
  // carry the same info inline. This test slot is kept to make the removal explicit.
  it("does not render the AttendanceCard component anywhere (removed in #XXX)", () => {
    renderWithTheme(<PlayerList {...attendanceBase} />);
    expect(screen.queryByText(/attendance/i)).toBeNull();
  });
});
