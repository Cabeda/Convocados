// eslint-disable @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { PlayerList } from "~/components/event/PlayerList";

afterEach(() => cleanup());

// Minimal translation stub so components using useT() render without locale data
vi.mock("~/lib/useT", () => ({
  useT: () => (key: string, params?: Record<string, string>) => {
    const map: Record<string, string> = {
      players: "Players",
      activePlayers: "Active ({n})",
      benchPlayers: "Bench ({n})",
      declinedPlayers: "Declined ({n})",
      declinedLabel: "Declined",
      invitedPlayers: "Invited ({n})",
      invitePendingLabel: "Pending",
      coPlaySuggestions: "Suggested for you",
      randomizeTeams: "Randomize teams",
      protectedPlayer: "Player",
      anonymousPlayer: "Anonymous",
      addPlayerPlaceholder: "Add player name or email",
      inviteByEmailOption: "Invite {email} by email",
      createNewPlayer: "Create new player: {name}",
      noSuggestions: "Type a new name",
    };
    let v = map[key] ?? key;
    for (const [k, val] of Object.entries(params ?? {})) v = v.replace(`{${k}}`, val);
    return v;
  },
}));

const players = [
  { id: "p1", name: "Alice", userId: "u1", image: null, order: 0 },
  { id: "p2", name: "Bob", userId: null, image: null, order: 1 },
];

const declined = [
  { id: "d1", name: "Carol", userId: "u3", image: null },
  { id: "d2", name: "Dave", userId: null, image: null },
];

const invited = [
  { id: "i1", name: "Erin", userId: "u4", image: null },
];

const coPlay = [
  { userId: "u5", name: "Frank", image: null, reason: "Played together 3 times" },
  { userId: "u6", name: "Grace", image: null, reason: "Plays every week" },
];

const knownPlayers = [
  { name: "Zoe", gamesPlayed: 4, userId: null, image: null },
  { name: "Frank", gamesPlayed: 9, userId: "u5", image: null },
];

function renderList(overrides: Partial<Parameters<typeof PlayerList>[0]> = {}) {
  const props = {
    players,
    maxPlayers: 2,
    isOwner: true,
    hasTeams: false,
    availableSuggestions: [],
    playerError: null,
    onPlayerErrorChange: vi.fn(),
    onAddPlayer: vi.fn().mockResolvedValue(undefined),
    onRequestAdd: vi.fn(),
    onRemovePlayer: vi.fn().mockResolvedValue(undefined),
    onReorderPlayers: vi.fn().mockResolvedValue(undefined),
    onResetPlayerOrder: vi.fn().mockResolvedValue(undefined),
    onRandomize: vi.fn(),
    onConfirmReRandomize: vi.fn(),
    canRemovePlayer: () => true,
    declined,
    invited,
    coPlaySuggestions: coPlay,
    ...overrides,
  };
  return { props, ...render(<PlayerList {...props} />) };
}

function typeInInput(value: string) {
  const input = screen.getByRole("combobox") as HTMLInputElement;
  fireEvent.change(input, { target: { value } });
  return input;
}

describe("PlayerList — ADR 0025 roster sections", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the Declined section collapsed by default and expands on toggle", async () => {
    renderList();
    expect(screen.getByText("Declined (2)")).toBeTruthy();
    expect(screen.getByTestId("declined-toggle")).toBeTruthy();
    // Collapsed: names hidden inside Collapse
    const collapse = screen.getByTestId("declined-collapse");
    expect(collapse.className).toMatch(/hidden|MuiCollapse-hidden/);
    fireEvent.click(screen.getByTestId("declined-toggle"));
    await waitFor(() => expect(screen.getByText("Carol")).toBeTruthy());
    expect(screen.getByText("Dave")).toBeTruthy();
  });

  it("renders the Invited section with names", () => {
    renderList();
    expect(screen.getByText("Invited (1)")).toBeTruthy();
    expect(screen.getByText("Erin")).toBeTruthy();
  });

  it("renders Invited above Declined", () => {
    renderList();
    const invitedEl = screen.getByText("Invited (1)");
    const declinedEl = screen.getByText("Declined (2)");
    expect(invitedEl.compareDocumentPosition(declinedEl) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("hides the Invited section when empty", () => {
    renderList({ invited: [] });
    expect(screen.queryByText("Invited (0)")).toBeNull();
  });

  it("renders co-play suggestion chips", () => {
    renderList();
    expect(screen.getByText("Suggested for you:")).toBeTruthy();
    expect(screen.getByText("Frank")).toBeTruthy();
    expect(screen.getByText("Grace")).toBeTruthy();
  });

  it("clicking a co-play chip requests the add-or-invite choice instead of inviting directly", () => {
    const { props } = renderList();
    const chip = screen.getByText("Frank");
    fireEvent.click(chip);
    expect(props.onRequestAdd).toHaveBeenCalledWith({
      kind: "single",
      name: "Frank",
      userId: "u5",
      source: "chip",
    });
  });

  it("does not render co-play chips for players already on the roster or invited", () => {
    const withDup = [
      ...coPlay,
      { userId: "u1", name: "Alice", image: null, reason: "already in" },
      { userId: "u4", name: "Erin", image: null, reason: "already invited" },
    ];
    renderList({ coPlaySuggestions: withDup });
    // Alice/Erin must not render as suggestion chips (only one Alice row is the roster row)
    const aliceRows = screen.getAllByText("Alice");
    expect(aliceRows.length).toBe(1);
    const erinRows = screen.getAllByText("Erin");
    expect(erinRows.length).toBe(1);
  });
});

describe("PlayerList — recent players deprecated, add box routes through the choice dialog", () => {
  it("does not render the Recent players chips section", () => {
    renderList({ availableSuggestions: knownPlayers });
    expect(screen.queryByText(/Recent players/)).toBeNull();
    expect(screen.queryByText("Zoe")).toBeNull();
  });

  it("does not render the name/email helper hint text", () => {
    renderList();
    expect(screen.queryByText(/Type a name to add/)).toBeNull();
    expect(screen.queryByText(/email to invite/)).toBeNull();
  });

  it("submit button requests the choice for a typed name", () => {
    const { props } = renderList();
    typeInInput("Zoe");
    fireEvent.click(screen.getByTestId("add-player-submit"));
    expect(props.onRequestAdd).toHaveBeenCalledWith({
      kind: "single",
      name: "Zoe",
      source: "input",
    });
    expect(props.onAddPlayer).not.toHaveBeenCalled();
  });

  it("submit button requests the choice with email for a typed email", () => {
    const { props } = renderList();
    typeInInput("zoe@example.com");
    fireEvent.click(screen.getByTestId("add-player-submit"));
    expect(props.onRequestAdd).toHaveBeenCalledWith({
      kind: "single",
      name: "zoe@example.com",
      email: "zoe@example.com",
      source: "input",
    });
    expect(props.onAddPlayer).not.toHaveBeenCalled();
  });

  it("picking a known player from the dropdown requests the choice with their userId", async () => {
    const { props } = renderList({ availableSuggestions: knownPlayers });
    typeInInput("Fra");
    await waitFor(() => {
      const option = screen.getByText("Frank");
      fireEvent.click(option);
    });
    expect(props.onRequestAdd).toHaveBeenCalledWith({
      kind: "single",
      name: "Frank",
      userId: "u5",
      source: "dropdown",
    });
  });
});