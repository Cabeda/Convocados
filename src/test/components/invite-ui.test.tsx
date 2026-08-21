import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
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
      inviteChipLabel: "Invite",
      randomizeTeams: "Randomize teams",
      protectedPlayer: "Player",
      anonymousPlayer: "Anonymous",
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
    onRemovePlayer: vi.fn().mockResolvedValue(undefined),
    onReorderPlayers: vi.fn().mockResolvedValue(undefined),
    onResetPlayerOrder: vi.fn().mockResolvedValue(undefined),
    onRandomize: vi.fn(),
    onConfirmReRandomize: vi.fn(),
    canRemovePlayer: () => true,
    declined,
    invited,
    coPlaySuggestions: coPlay,
    onInviteUser: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { props, ...render(<PlayerList {...props} />) };
}

describe("PlayerList — ADR 0025 roster sections", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders the Declined section with names", () => {
    renderList();
    expect(screen.getByText("Declined (2)")).toBeTruthy();
    expect(screen.getByText("Carol")).toBeTruthy();
    expect(screen.getByText("Dave")).toBeTruthy();
  });

  it("renders the Invited section with names", () => {
    renderList();
    expect(screen.getByText("Invited (1)")).toBeTruthy();
    expect(screen.getByText("Erin")).toBeTruthy();
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

  it("clicking a co-play chip calls onInviteUser with the right user", async () => {
    const { props } = renderList();
    const chip = screen.getByText("Frank");
    fireEvent.click(chip);
    expect(props.onInviteUser).toHaveBeenCalledWith("u5", "Frank");
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