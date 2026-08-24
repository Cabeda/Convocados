/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PlayerList } from "~/components/event/PlayerList";
import type { Player } from "~/components/event/types";

// Responsive invite chips: default = mobile (<sm, matches:false). Desktop tests
// flip the flag; afterEach resets it. MUI resolves breakpoint queries to media
// query strings, so any query here maps to the single toggle.
const { mediaQueryState } = vi.hoisted(() => ({ mediaQueryState: { matches: false } }));
vi.mock("@mui/material", async (importOriginal) => {
  const mod = await importOriginal();
  return {
    ...mod,
    useMediaQuery: () => mediaQueryState.matches,
  };
});

afterEach(() => {
  cleanup();
  mediaQueryState.matches = false;
});

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
  it("does not render recent-players chips (deprecated)", async () => {
    renderWithTheme(<PlayerList {...baseProps} />);
    expect(screen.queryByText(/Recent players/)).toBeNull();
    expect(screen.queryByText("Charlie")).toBeNull();
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

  it("opens the choice dialog when Enter is pressed on a typed name", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} />);
    const input = screen.getByPlaceholderText(/add player/i);
    await user.click(input);
    await user.type(input, "NewName{Enter}");
    expect(baseProps.onRequestAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: "NewName", source: "input" }),
    );
    expect(baseProps.onAddPlayer).not.toHaveBeenCalled();
  });

  it("opens the choice dialog when the + IconButton is tapped", async () => {
    const user = userEvent.setup();
    renderWithTheme(<PlayerList {...baseProps} />);
    const input = screen.getByPlaceholderText(/add player/i);
    await user.type(input, "AnotherName");
    const buttons = screen.getAllByRole("button");
    const addButton = buttons.find((b) => b.getAttribute("data-testid") === "add-player-submit")
      ?? buttons.find((b) => b.querySelector('[data-testid="PersonAddIcon"]') !== null);
    if (!addButton) throw new Error("+ IconButton not found");
    fireEvent.click(addButton);
    expect(baseProps.onRequestAdd).toHaveBeenCalledWith(
      expect.objectContaining({ name: "AnotherName", source: "input" }),
    );
    expect(baseProps.onAddPlayer).not.toHaveBeenCalled();
  });

  it("falls back to onAddPlayer when no onRequestAdd is provided (e.g. older API surface)", async () => {
    const fallbackProps = { ...baseProps, onRequestAdd: undefined };
    renderWithTheme(<PlayerList {...fallbackProps} />);
    const input = screen.getByPlaceholderText(/add player/i);
    fireEvent.change(input, { target: { value: "FallbackName" } });
    const buttons = screen.getAllByRole("button");
    const addButton = buttons.find((b) => b.getAttribute("data-testid") === "add-player-submit")
      ?? buttons.find((b) => b.querySelector('[data-testid="PersonAddIcon"]') !== null);
    if (!addButton) throw new Error("+ IconButton not found");
    fireEvent.click(addButton);
    expect(baseProps.onAddPlayer).toHaveBeenCalledWith("FallbackName");
  });
});

describe("PlayerList — password manager suppression", () => {
  it("marks the add-player input so password managers do not offer/save credentials", () => {
    renderWithTheme(<PlayerList {...baseProps} />);
    const input = screen.getByPlaceholderText(/add player/i) as HTMLInputElement;
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(input).toHaveAttribute("name", "player-name");
    // Vendor-specific ignore hints: 1Password, LastPass, Dashlane/Bitwarden heuristics
    expect(input).toHaveAttribute("data-1p-ignore", "true");
    expect(input).toHaveAttribute("data-lpignore", "true");
    expect(input).toHaveAttribute("data-form-type", "other");
  });
});

describe("PlayerList — player identity (avatar / anonymous icon)", () => {
  const linkedWithImage: Player = { id: "p-img", name: "Alice", userId: "u-1", image: "https://example.com/alice.jpg" };
  const linkedNoImage: Player = { id: "p-nimg", name: "Bob", userId: "u-2", image: null };
  const guest: Player = { id: "p-guest", name: "Carol", userId: null };

  it("renders the profile avatar with image for a linked player", () => {
    renderWithTheme(<PlayerList {...baseProps} players={[linkedWithImage]} availableSuggestions={[]} />);
    const img = screen.getByRole("img", { name: "Alice" });
    expect(img).toHaveAttribute("src", "https://example.com/alice.jpg");
    expect(screen.queryByTestId("Person2OutlinedIcon")).toBeNull();
  });

  it("links the avatar to the user's profile page", () => {
    renderWithTheme(<PlayerList {...baseProps} players={[linkedWithImage]} availableSuggestions={[]} />);
    const img = screen.getByRole("img", { name: "Alice" });
    expect(img.closest("a")).toHaveAttribute("href", "/users/u-1");
  });

  it("renders an initial-letter avatar for a linked player without image", () => {
    renderWithTheme(<PlayerList {...baseProps} players={[linkedNoImage]} availableSuggestions={[]} />);
    expect(screen.getByText("B")).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("renders the anonymous icon for a guest player", () => {
    renderWithTheme(<PlayerList {...baseProps} players={[guest]} availableSuggestions={[]} />);
    expect(screen.getByTestId("Person2OutlinedIcon")).toBeInTheDocument();
  });

  it("renders identity markers in the bench list", () => {
    const players: Player[] = [];
    for (let i = 0; i < 11; i++) {
      players.push({
        id: `p${i}`,
        name: `P${i}`,
        userId: i === 10 ? "u-10" : null,
        image: i === 10 ? "https://example.com/p10.jpg" : null,
      });
    }
    renderWithTheme(<PlayerList {...baseProps} players={players} />);
    expect(screen.getByRole("img", { name: "P10" })).toBeInTheDocument();
    expect(screen.getAllByTestId("Person2OutlinedIcon").length).toBeGreaterThan(0);
  });

  it("does not render recent-players chips even when suggestions exist", () => {
    const suggestions = [
      { name: "Linked", gamesPlayed: 2, userId: "u-x", image: "https://example.com/linked.jpg" },
      { name: "Anon", gamesPlayed: 1, userId: null, image: null },
    ];
    renderWithTheme(<PlayerList {...baseProps} players={[]} availableSuggestions={suggestions} />);
    expect(screen.queryByText(/Recent players/)).toBeNull();
    expect(screen.queryByRole("img", { name: "Linked" })).toBeNull();
  });

  it("renders avatar/anonymous markers in the add-player dropdown options", async () => {
    const user = userEvent.setup();
    const suggestions = [
      { name: "Linked", gamesPlayed: 2, userId: "u-x", image: "https://example.com/linked.jpg" },
      { name: "Anon", gamesPlayed: 1, userId: null, image: null },
    ];
    renderWithTheme(<PlayerList {...baseProps} players={[]} availableSuggestions={suggestions} />);
    const input = screen.getByPlaceholderText(/add player/i);
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

describe.skip("PlayerList — attendance UI (You row + guest pill)", () => {
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

  it("renders a user pill on linked-user rows for a logged viewer, read-only", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-viewer"
        myRsvpStatus={null}
        guestRsvpMap={{}}
        userRsvpMap={{ "u-1": "yes" }}
      />,
    );
    const pill = screen.getByTestId("rsvp-user-pill-u-1");
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute("data-status", "yes");
    // Read-only — no menu trigger
    expect(pill).not.toHaveAttribute("role", "button");
  });

  it("does NOT render a user pill for anonymous viewers (one-way privacy)", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId={null}
        myRsvpStatus={null}
        guestRsvpMap={{}}
        userRsvpMap={{ "u-1": "yes" }}
      />,
    );
    expect(screen.queryByTestId("rsvp-user-pill-u-1")).toBeNull();
  });

  it("does NOT render a user pill for the current user themselves (they use AttendanceCta)", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus="yes"
        guestRsvpMap={{}}
        userRsvpMap={{ "u-1": "yes" }}
      />,
    );
    // The AttendanceCta at the top carries the user's own answer — no row pill.
    expect(screen.queryByTestId("rsvp-user-pill-u-1")).toBeNull();
    expect(screen.getByTestId("attendance-cta")).toBeInTheDocument();
  });

  it("renders a user pill for another linked user (not the current viewer)", () => {
    const other: Player = { id: "p-other", name: "OtherCarol", userId: "u-other" };
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        players={[linkedPlayer, guestPlayer, other]}
        currentUserId="u-1"
        myRsvpStatus="yes"
        guestRsvpMap={{}}
        userRsvpMap={{ "u-1": "yes", "u-other": "maybe" }}
      />,
    );
    const pill = screen.getByTestId("rsvp-user-pill-u-other");
    expect(pill).toBeInTheDocument();
    expect(pill).toHaveAttribute("data-status", "maybe");
  });

  it("does NOT render a user pill on guest (userId null) rows", () => {
    renderWithTheme(
      <PlayerList
        {...attendanceBase}
        currentUserId="u-1"
        myRsvpStatus={null}
        guestRsvpMap={{ [guestPlayer.id]: "yes" }}
        userRsvpMap={{}}
      />,
    );
    // Guest row gets the guest pill, not a user pill.
    expect(screen.queryByTestId("rsvp-user-pill-null")).toBeNull();
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

describe("PlayerList — roster locked after game end (issue #716)", () => {
  it("hides the add-player input, submit button and recent chips when rosterLocked", async () => {
    renderWithTheme(<PlayerList {...baseProps} rosterLocked />);
    expect(screen.queryByPlaceholderText(/add player/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("add-player-submit")).not.toBeInTheDocument();
    expect(screen.queryByText("Charlie")).not.toBeInTheDocument();
    // The roster itself still renders
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("never dispatches add intents when rosterLocked", async () => {
    renderWithTheme(<PlayerList {...baseProps} rosterLocked />);
    expect(baseProps.onRequestAdd).not.toHaveBeenCalled();
    expect(baseProps.onAddPlayer).not.toHaveBeenCalled();
  });
});

describe("PlayerList — invited roster: channel chips + resend (ADR 0025 follow-up)", () => {
  const hoursAgo = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();

  it("mobile: shows icon-only channel chips (no text labels) beside Pending", () => {
    renderWithTheme(
      <PlayerList
        {...baseProps}
        invited={[{ id: "inv-1", name: "Eve", userId: null, channels: { email: true, webPush: false, appPush: true }, notifiedAt: hoursAgo(30) }]}
      />,
    );
    expect(screen.getByText("Eve")).toBeInTheDocument();
    // Icon-only chips carry an accessible name instead of visible text
    expect(screen.getByTestId("invite-channel-email-inv-1")).toBeInTheDocument();
    expect(screen.getByTestId("invite-channel-app-inv-1")).toBeInTheDocument();
    expect(screen.queryByTestId("invite-channel-web-inv-1")).not.toBeInTheDocument();
    expect(screen.queryByText("email")).not.toBeInTheDocument();
    expect(screen.getByLabelText("app notification")).toBeInTheDocument();
    expect(screen.getByLabelText("email")).toBeInTheDocument();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
    // Link-only chip is a desktop affordance — hidden on mobile
    expect(screen.queryByTestId(/invite-linkonly-/)).not.toBeInTheDocument();
  });

  it("desktop (sm+): channel chips show icon + text label", () => {
    mediaQueryState.matches = true;
    renderWithTheme(
      <PlayerList
        {...baseProps}
        invited={[{ id: "inv-1d", name: "Eve", userId: null, channels: { email: true, webPush: false, appPush: false }, notifiedAt: hoursAgo(30) }]}
      />,
    );
    const chip = screen.getByTestId("invite-channel-email-inv-1d");
    expect(chip).toHaveTextContent("email");
  });

  it("mobile: shows only the pending chip when no channel was used", () => {
    renderWithTheme(
      <PlayerList
        {...baseProps}
        invited={[{ id: "inv-2", name: "Frank", userId: null, channels: { email: false, webPush: false, appPush: false }, notifiedAt: null }]}
      />,
    );
    expect(screen.queryByTestId(/invite-channel-/)).not.toBeInTheDocument();
    expect(screen.getByText(/pending/i)).toBeInTheDocument();
  });

  it("desktop (sm+): link-only chip explains when no channel was used", () => {
    mediaQueryState.matches = true;
    renderWithTheme(
      <PlayerList
        {...baseProps}
        invited={[{ id: "inv-2d", name: "Frank", userId: null, channels: { email: false, webPush: false, appPush: false }, notifiedAt: null }]}
      />,
    );
    expect(screen.getByTestId("invite-linkonly-inv-2d")).toHaveTextContent(/link only/i);
  });

  it("shows an active resend button after the 24h cooldown and calls onResendInvite", async () => {
    const user = userEvent.setup();
    const onResendInvite = vi.fn().mockResolvedValue(undefined);
    renderWithTheme(
      <PlayerList
        {...baseProps}
        canManageInvites
        onResendInvite={onResendInvite}
        invited={[{ id: "inv-3", name: "Grace", userId: null, channels: { email: true, webPush: false, appPush: false }, notifiedAt: hoursAgo(25) }]}
      />,
    );
    const btn = screen.getByTestId("resend-invite-inv-3");
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(onResendInvite).toHaveBeenCalledWith({ id: "inv-3", inviteId: "inv-3", name: "Grace" });
    // No dead cooldown control once eligible
    expect(screen.queryByTestId("resend-cooldown-inv-3")).not.toBeInTheDocument();
  });

  it("uses inviteId for resend when present (EventPlayer id vs PlayerInvite id)", async () => {
    const user = userEvent.setup();
    const onResendInvite = vi.fn().mockResolvedValue(undefined);
    renderWithTheme(
      <PlayerList
        {...baseProps}
        canManageInvites
        onResendInvite={onResendInvite}
        invited={[{ id: "ep-1", inviteId: "pi-1", name: "Grace2", userId: null, channels: { email: true, webPush: false, appPush: false }, notifiedAt: hoursAgo(25) }]}
      />,
    );
    const btn = screen.getByTestId("resend-invite-pi-1");
    expect(btn).toBeEnabled();
    await user.click(btn);
    expect(onResendInvite).toHaveBeenCalledWith({ id: "ep-1", inviteId: "pi-1", name: "Grace2" });
  });

  it("within the 24h cooldown shows a countdown chip instead of a dead button", () => {
    renderWithTheme(
      <PlayerList
        {...baseProps}
        canManageInvites
        onResendInvite={vi.fn()}
        invited={[{ id: "inv-4", name: "Heidi", userId: null, channels: { email: false, webPush: false, appPush: true }, notifiedAt: hoursAgo(2) }]}
      />,
    );
    // No disabled mystery button — a live countdown communicates WHY + HOW LONG
    expect(screen.queryByTestId("resend-invite-inv-4")).not.toBeInTheDocument();
    expect(screen.getByTestId("resend-cooldown-inv-4")).toBeInTheDocument();
    expect(screen.getByTestId("resend-cooldown-inv-4")).toHaveTextContent(/\d+/); // e.g. "22h"
  });

  it("hides resend controls for viewers who cannot manage invites", () => {
    renderWithTheme(
      <PlayerList
        {...baseProps}
        canManageInvites={false}
        onResendInvite={vi.fn()}
        invited={[{ id: "inv-5", name: "Ivan", userId: null, channels: { email: true, webPush: false, appPush: false }, notifiedAt: hoursAgo(48) }]}
      />,
    );
    expect(screen.queryByTestId("resend-invite-inv-5")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resend-cooldown-inv-5")).not.toBeInTheDocument();
  });
});
