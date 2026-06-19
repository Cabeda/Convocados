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
  };

  beforeEach(() => {
    onSetMyRsvp.mockClear();
    onSetGuestRsvp.mockClear();
    onRemovePlayer.mockClear();
  });

  it("does not render the You row when currentUserId is null (anonymous)", () => {
    renderWithTheme(
      <PlayerList {...attendanceBase} currentUserId={null} myRsvpStatus={null} guestRsvpMap={{}} />,
    );
    expect(screen.queryByTestId("rsvp-you-row")).toBeNull();
  });

  it("does not render the You row when the user is not on the active list (follower-only)", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-someone-else"
        myRsvpStatus={null}
        guestRsvpMap={{}}
      />,
    );
    expect(screen.queryByTestId("rsvp-you-row")).toBeNull();
  });

  it("renders the You row at the top of the active list when the user is on it", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus={null}
        guestRsvpMap={{}}
      />,
    );
    const youRow = screen.getByTestId("rsvp-you-row");
    expect(youRow).toBeInTheDocument();
    expect(youRow).toHaveTextContent(/You/i);
    expect(youRow).toHaveTextContent(/LinkedAlice/);
  });

  it("reflects the current RSVP status on the You row chip", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus="yes"
        guestRsvpMap={{}}
      />,
    );
    const status = screen.getByTestId("rsvp-you-status");
    expect(status).toHaveAttribute("data-status", "yes");
  });

  it("calls onSetMyRsvp('yes') when the Yes button is clicked", async () => {
    const user = userEvent.setup();
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus={null}
        guestRsvpMap={{}}
      />,
    );
    await user.click(screen.getByTestId("rsvp-you-yes"));
    expect(attendanceBase.onSetMyRsvp).toHaveBeenCalledWith("yes");
  });

  it("opens the confirm dialog when the No button is clicked (does not call onSetMyRsvp directly)", async () => {
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
    await user.click(screen.getByTestId("rsvp-you-no"));
    // The dialog should be open. onSetMyRsvp is called only after the user confirms.
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
        eventDateTime={new Date(Date.now() + 7 * 86400_000).toISOString()}
      />,
    );
    await user.click(screen.getByTestId("rsvp-you-no"));
    await user.click(await screen.findByTestId("leave-dialog-confirm"));
    expect(attendanceBase.onSetMyRsvp).toHaveBeenCalledWith("no");
  });

  it("disables the matching button when the user is already at that status", () => {
    const { rerender } = renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus="yes"
        guestRsvpMap={{}}
      />,
    );
    expect(screen.getByTestId("rsvp-you-yes")).toBeDisabled();
    expect(screen.getByTestId("rsvp-you-no")).not.toBeDisabled();

    rerender(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus="no"
        guestRsvpMap={{}}
      />,
    );
    expect(screen.getByTestId("rsvp-you-no")).toBeDisabled();
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

  it("calls onSetGuestRsvp with the next state when admin clicks the pill (Pending → Yes)", async () => {
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
    expect(attendanceBase.onSetGuestRsvp).toHaveBeenCalledWith(guestPlayer.id, "yes");
  });

  it("opens the confirm dialog when admin clicks a guest pill cycling to 'no'", async () => {
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
    // Confirm dialog opens (not a direct call to onSetGuestRsvp).
    expect(await screen.findByTestId("leave-dialog-confirm")).toBeInTheDocument();
    expect(attendanceBase.onSetGuestRsvp).not.toHaveBeenCalled();
  });

  it("cycles No → null (clear) when admin clicks the pill again", async () => {
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
    // When canEditGuestAttendance is false the chip is rendered with the outlined (read-only)
    // variant — distinct from the filled variant we use for the admin-clickable pill.
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

  it("does not render the AttendanceCard when attendanceSummaryEventId is not provided", () => {
    renderWithTheme(<PlayerList {...attendanceBase} />);
    expect(screen.queryByText(/attendance/i)).toBeNull();
  });

  it("renders the AttendanceCard footer when attendanceSummaryEventId is provided", async () => {
    // Mock the summary endpoint to return a known payload.
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ yes: 3, no: 1, pending: 2 }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        attendanceSummaryEventId="evt-1"
      />,
    );
    // The card fetches the summary on mount; the heading copy uses t("attendanceCard") → "Attendance".
    expect(await screen.findByText(/attendance/i)).toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(
      "/api/events/evt-1/rsvp/summary",
      expect.objectContaining({ credentials: "include" }),
    );
    fetchSpy.mockRestore();
  });
});
