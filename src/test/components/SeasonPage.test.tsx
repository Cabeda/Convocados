import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, cleanup, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import SeasonPage from "~/components/SeasonPage";

const members = Array.from({ length: 6 }, (_, index) => ({
  membershipId: `membership-${index}`,
  eventPlayerId: `player-${index}`,
  name: `Player ${index}`,
  rating: 1000 + index * 50,
  crewId: null,
}));

function seasonResponse(
  crews: Array<{ id?: string; name: string; membershipIds: string[] }> = [],
  status = "registration",
) {
  return {
    season: {
      id: "season-1",
      name: "September Season",
      status,
      registrationOpensAt: "2026-09-01T00:00:00.000Z",
      registrationClosesAt: "2026-09-30T00:00:00.000Z",
      viewerEventPlayerId: null as string | null,
      viewerMembership: null as { id: string; status: string; eventPlayerId: string } | null,
      registrationOpen: status === "registration",
      crews: crews.map((crew, sortOrder) => ({
        id: crew.id ?? `crew-${sortOrder}`,
        name: crew.name,
        sortOrder,
        members: crew.membershipIds.map((membershipId) => ({
          name: members.find((member) => member.membershipId === membershipId)?.name ?? "",
          membershipId,
        })),
      })),
      activeMembers: members,
    },
  };
}

function proposalPanelResponse() {
  return { canPropose: false, canReview: true, candidates: [], proposals: [] };
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SeasonPage", () => {
  it("recommends Crews, allows renaming and reassignment, then saves the adjusted setup", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ crews: [
        { name: "Crew 1", membershipIds: members.slice(0, 3).map((member) => member.membershipId) },
        { name: "Crew 2", membershipIds: members.slice(3).map((member) => member.membershipId) },
      ] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse([
        { id: "crew-1", name: "North", membershipIds: members.slice(0, 4).map((member) => member.membershipId) },
        { id: "crew-2", name: "South", membershipIds: members.slice(4).map((member) => member.membershipId) },
      ])), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    await user.click(screen.getByRole("button", { name: "Recommend Crews" }));
    expect(await screen.findByDisplayValue("Crew 1")).toBeInTheDocument();

    const crewNames = screen.getAllByLabelText("Crew name");
    fireEvent.change(crewNames[0], { target: { value: "North" } });
    await user.click(screen.getByRole("combobox", { name: "Crew for Player 0" }));
    await user.click(screen.getByRole("option", { name: "Crew 2" }));
    await user.click(screen.getByRole("button", { name: "Save Season setup" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    const saveRequest = fetchMock.mock.calls[3][1];
    expect(JSON.parse(String(saveRequest?.body))).toMatchObject({
      crews: [
        { name: "North", membershipIds: expect.not.arrayContaining(["membership-0"]) },
        { name: "Crew 2", membershipIds: expect.arrayContaining(["membership-0"]) },
      ],
    });
    expect(await screen.findByText("Season setup saved.")).toBeInTheDocument();
  });

  it("pre-fills the season details with the current name and period", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    expect(screen.getByLabelText("Season name")).toHaveValue("September Season");
    expect(screen.getByLabelText("Registration opens")).toHaveValue("2026-09-01");
    expect(screen.getByLabelText("Registration closes")).toHaveValue("2026-09-30");
  });

  it("saves edited season details", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        season: { id: "season-1", name: "Autumn Season", registrationOpensAt: "2026-10-01T00:00:00.000Z", registrationClosesAt: "2026-10-31T00:00:00.000Z" },
      }), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    await user.clear(screen.getByLabelText("Season name"));
    await user.type(screen.getByLabelText("Season name"), "Autumn Season");
    await user.clear(screen.getByLabelText("Registration opens"));
    await user.type(screen.getByLabelText("Registration opens"), "2026-10-01");
    await user.clear(screen.getByLabelText("Registration closes"));
    await user.type(screen.getByLabelText("Registration closes"), "2026-10-31");
    await user.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const patchCall = fetchMock.mock.calls[2];
    expect(patchCall[0]).toBe("/api/events/event-1/seasons/season-1");
    expect(patchCall[1]?.method).toBe("PATCH");
    expect(JSON.parse(String(patchCall[1]?.body))).toMatchObject({
      action: "update",
      name: "Autumn Season",
      registrationOpensAt: "2026-10-01",
      registrationClosesAt: "2026-10-31",
    });
    expect(await screen.findByText("Season details saved.")).toBeInTheDocument();
  });

  it("removes a member from the season", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse([
        { id: "crew-1", name: "North", membershipIds: members.slice(0, 3).map((member) => member.membershipId) },
        { id: "crew-2", name: "South", membershipIds: members.slice(3).map((member) => member.membershipId) },
      ])), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ membership: { id: "membership-0", status: "withdrawn" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse([
        { id: "crew-1", name: "North", membershipIds: members.slice(1, 3).map((member) => member.membershipId) },
        { id: "crew-2", name: "South", membershipIds: members.slice(3).map((member) => member.membershipId) },
      ])), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    await user.click(screen.getByRole("button", { name: "Remove Player 0 from the season" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/events/event-1/seasons/season-1/memberships/membership-0");
    expect(fetchMock.mock.calls[2][1]?.method).toBe("DELETE");
    expect(await screen.findByText("Removed Player 0 from the season.")).toBeInTheDocument();
    // The member left every draft Crew (and falls back to unassigned).
    expect(within(screen.getByTestId("crew-card-0")).queryByTestId("member-row-membership-0")).not.toBeInTheDocument();
  });

  it("renders the season standings embedded in the season response", async () => {
    const fetchMock = vi.mocked(fetch);
    const withLeaderboard = seasonResponse();
    (withLeaderboard.season as Record<string, unknown>).leaderboard = {
      scope: { type: "season", seasonId: "season-1", name: "September Season", startsAt: null, endsAt: null },
      gamesCount: 1,
      players: [{ rank: 1, name: "Alice", crewName: null, points: 3, played: 1, wins: 1, draws: 0, losses: 0, goalsFor: 2, goalsAgainst: 1, goalDifference: 1 }],
      crews: [{ rank: 1, crewId: "crew-1", name: "Brothers", points: 3, tieBreakTotal: 3, roundsCounted: 1, roundsRepresented: 1, gameScores: [] }],
    };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(withLeaderboard), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    expect(await screen.findByText("Standings")).toBeInTheDocument();
    // Season Rank replaces the individual Player league; the Crew league stays.
    expect(screen.getByText("Brothers")).toBeInTheDocument();
    expect(screen.queryByText("Alice")).not.toBeInTheDocument();
  });

  it("shows the average ELO of each recommended Crew", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ crews: [
        { name: "Crew 1", membershipIds: members.slice(0, 3).map((member) => member.membershipId) },
        { name: "Crew 2", membershipIds: members.slice(3).map((member) => member.membershipId) },
      ] }), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });
    await user.click(screen.getByRole("button", { name: "Recommend Crews" }));

    // members ratings: 1000 + index*50 → Crew 1 mean 1050, Crew 2 mean 1200.
    expect(await screen.findByText("Crew ELO 1050")).toBeInTheDocument();
    expect(screen.getByText("Crew ELO 1200")).toBeInTheDocument();
  });

  it("lets an admin add an empty Crew and assign players to it", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const twelve = Array.from({ length: 12 }, (_, index) => ({
      membershipId: `m-${index}`,
      eventPlayerId: `p-${index}`,
      name: `P${index}`,
      rating: 1000,
      crewId: null,
    }));
    const customSeason = {
      season: {
        id: "season-1",
        name: "September Season",
        status: "registration",
        registrationOpensAt: "2026-09-01T00:00:00.000Z",
        registrationClosesAt: "2026-09-30T00:00:00.000Z",
        viewerEventPlayerId: null,
        viewerMembership: null,
        registrationOpen: true,
        crews: [
          { id: "crew-1", name: "North", sortOrder: 0, members: twelve.slice(0, 3).map((m) => ({ name: m.name, membershipId: m.membershipId })) },
          { id: "crew-2", name: "South", sortOrder: 1, members: twelve.slice(3, 6).map((m) => ({ name: m.name, membershipId: m.membershipId })) },
        ],
        activeMembers: twelve,
      },
    };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(customSeason), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(customSeason), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    await user.click(screen.getByRole("button", { name: "Add crew" }));
    expect(await screen.findByDisplayValue("Crew 3")).toBeInTheDocument();

    for (const name of ["Crew for P6", "Crew for P7", "Crew for P8"]) {
      await user.click(screen.getByRole("combobox", { name }));
      await user.click(screen.getByRole("option", { name: "Crew 3" }));
    }
    await user.click(screen.getByRole("button", { name: "Save Season setup" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const saveRequest = fetchMock.mock.calls[2][1];
    expect(JSON.parse(String(saveRequest?.body)).crews).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Crew 3", membershipIds: expect.arrayContaining(["m-6", "m-7", "m-8"]) }),
    ]));
  });

  it("moves a player between Crews by drag and drop", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse([
        { id: "crew-1", name: "North", membershipIds: members.slice(0, 3).map((member) => member.membershipId) },
        { id: "crew-2", name: "South", membershipIds: members.slice(3).map((member) => member.membershipId) },
      ])), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    const playerRow = screen.getByTestId("member-row-membership-0");
    expect(screen.getByTestId("member-grip-membership-0")).toBeInTheDocument();
    fireEvent.dragStart(playerRow);
    const crewTwoCard = screen.getByTestId("crew-card-1");
    fireEvent.dragOver(crewTwoCard);
    fireEvent.drop(crewTwoCard);

    // Player 0 now sits in Crew "South" (select value reflects the move).
    expect(screen.getByRole("combobox", { name: "Crew for Player 0" })).toHaveTextContent("South");
  });

  it("adds recent players to the season and shows the result", async () => {
    const fetchMock = vi.mocked(fetch);
    const refreshed = seasonResponse();
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        added: [
          { membershipId: "membership-0", eventPlayerId: "player-0", name: "Player 0" },
          { membershipId: "membership-1", eventPlayerId: "player-1", name: "Player 1" },
        ],
        skipped: [{ eventPlayerId: "player-9", name: "Guest", reason: "noAccount" }],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(refreshed), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    await fireEvent.click(screen.getByRole("button", { name: "Add recent players" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/events/event-1/seasons/season-1/memberships/bulk");
    expect(await screen.findByText("Added 2 players to the season. 1 skipped (no account yet: Guest).")).toBeInTheDocument();
  });

  it("reports when no recent players can be added", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ added: [], skipped: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse()), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    await fireEvent.click(screen.getByRole("button", { name: "Add recent players" }));

    expect(await screen.findByText("No players from recent games to add.")).toBeInTheDocument();
  });

  it("enrolls a searched player directly into a Crew", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const candidates = { players: [
      { eventPlayerId: "player-9", name: "Zed", hasAccount: true, gamesPlayed: 2, memberStatus: null },
      { eventPlayerId: "player-10", name: "Guest", hasAccount: false, gamesPlayed: 1, memberStatus: null },
    ] };
    const withCrews = seasonResponse([
      { id: "crew-1", name: "North", membershipIds: members.slice(0, 3).map((member) => member.membershipId) },
      { id: "crew-2", name: "South", membershipIds: members.slice(3).map((member) => member.membershipId) },
    ]);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(withCrews), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(candidates), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        membership: { id: "membership-9", eventPlayerId: "player-9", userId: "user-9", status: "active", crewId: "crew-1" },
      }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(withCrews), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    await user.click(screen.getByRole("combobox", { name: "Add player to North" }));
    await user.type(screen.getByRole("combobox", { name: "Add player to North" }), "Zed");
    await user.click(await screen.findByRole("option", { name: "Zed" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(fetchMock.mock.calls[3][0]).toBe("/api/events/event-1/seasons/season-1/memberships");
    expect(JSON.parse(String(fetchMock.mock.calls[3][1]?.body))).toEqual({ eventPlayerId: "player-9", crewId: "crew-1" });
    expect(await screen.findByText("Added Zed to North.")).toBeInTheDocument();
  });

  it("disables candidates without an account in the player search", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const candidates = { players: [
      { eventPlayerId: "player-10", name: "Guest", hasAccount: false, gamesPlayed: 1, memberStatus: null },
    ] };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(candidates), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    await user.click(screen.getByRole("combobox", { name: "Add player" }));
    await user.type(screen.getByRole("combobox", { name: "Add player" }), "Guest");

    expect(await screen.findByRole("option", { name: "Guest (no account)" })).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the admin crew-editing UI available on an active Season", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse([
        { id: "crew-1", name: "North", membershipIds: members.slice(0, 3).map((member) => member.membershipId) },
        { id: "crew-2", name: "South", membershipIds: members.slice(3).map((member) => member.membershipId) },
      ], "active")), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    expect(screen.getByRole("button", { name: "Recommend Crews" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save Season setup" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start season" })).not.toBeInTheDocument();
  });

  it("renders a completed Season as read-only even for an administrator", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse([
      { id: "crew-1", name: "North", membershipIds: members.slice(0, 3).map((member) => member.membershipId) },
      { id: "crew-2", name: "South", membershipIds: members.slice(3).map((member) => member.membershipId) },
    ], "completed")), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    expect(screen.getByRole("link", { name: "Back to seasons" })).toHaveAttribute("href", "/events/event-1/seasons");
    expect(screen.getByText("North")).toBeInTheDocument();
    expect(screen.getByText("South")).toBeInTheDocument();
    expect(screen.getByText("This Season is read-only.")).toBeInTheDocument();
    expect(screen.queryByText("Set a starting date, recommend balanced Crews, and adjust them before saving.")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Season start date")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recommend Crews" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Save Season setup" })).not.toBeInTheDocument();
  });

  it("surfaces recommendation errors without changing the current setup", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "2 Crews require between 6 and 10 participants." }), { status: 422 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });
    await user.click(screen.getByRole("button", { name: "Recommend Crews" }));

    expect(await screen.findByText("2 Crews require between 6 and 10 participants.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Crew name")).not.toBeInTheDocument();
  });

  it("lets an account-linked Event player join the Season from the Season page", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const initial = seasonResponse();
    initial.season.viewerEventPlayerId = "player-0";
    initial.season.viewerMembership = null;
    initial.season.registrationOpen = true;
    const joined = seasonResponse();
    joined.season.viewerEventPlayerId = "player-0";
    joined.season.viewerMembership = { id: "membership-0", status: "active", eventPlayerId: "player-0" };
    joined.season.registrationOpen = true;
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(initial), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ membership: joined.season.viewerMembership }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(joined), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await user.click(await screen.findByRole("button", { name: "Join Season" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    expect(fetchMock.mock.calls[2][0]).toBe("/api/events/event-1/seasons/season-1/membership");
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({ eventPlayerId: "player-0" });
  });

  it("disables Start season until the pilot minimums are met", async () => {
    const fetchMock = vi.mocked(fetch);
    // 6 members in 2 crews — below the 3-crew / 9-participant gate.
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(seasonResponse([
        { id: "crew-1", name: "North", membershipIds: members.slice(0, 3).map((m) => m.membershipId) },
        { id: "crew-2", name: "South", membershipIds: members.slice(3).map((m) => m.membershipId) },
      ])), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    expect(screen.getByRole("button", { name: "Start season" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "View history" }))
      .toHaveAttribute("href", "/events/event-1/history");
  });

  it("enables Start season once there are 3 Crews and 9 participants", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const nine = Array.from({ length: 9 }, (_, i) => ({
      membershipId: `m-${i}`, eventPlayerId: `p-${i}`, name: `P${i}`, rating: 1000, crewId: `crew-${Math.floor(i / 3)}`,
    }));
    const ready = {
      season: {
        id: "season-1", name: "September Season", status: "registration",
        viewerEventPlayerId: null, viewerMembership: null, registrationOpen: true,
        crews: [0, 1, 2].map((c) => ({
          id: `crew-${c}`, name: `Crew ${c + 1}`, sortOrder: c,
          members: nine.filter((m) => m.crewId === `crew-${c}`).map((m) => ({ name: m.name, membershipId: m.membershipId })),
        })),
        activeMembers: nine,
      },
    };
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(ready), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ season: { id: "season-1", status: "active", activatedAt: new Date().toISOString() } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...ready, season: { ...ready.season, status: "active" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPanelResponse()), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "September Season" });

    const startButton = screen.getByRole("button", { name: "Start season" });
    expect(startButton).toBeEnabled();
    await user.click(startButton);

    await waitFor(() => expect(fetchMock.mock.calls.some((call) =>
      call[0] === "/api/events/event-1/seasons/season-1" && call[1]?.method === "PATCH",
    )).toBe(true));
    const patchCall = fetchMock.mock.calls.find((call) => call[1]?.method === "PATCH");
    expect(JSON.parse(String(patchCall?.[1]?.body))).toEqual({ action: "activate" });
  });
});


describe("SeasonPage proposal refresh", () => {
  it("refreshes the organizer draft after approving a Crew proposal", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const pendingProposal = {
      canPropose: false,
      canReview: true,
      candidates: [],
      proposals: [{
        id: "proposal-1",
        name: "North",
        status: "pending",
        proposerName: "Player 0",
        memberNames: ["Player 0", "Player 1", "Player 2"],
      }],
    };
    const approvedProposal = { ...pendingProposal, proposals: [{ ...pendingProposal.proposals[0], status: "approved" }] };
    const initialSeason = seasonResponse([{ id: "crew-2", name: "South", membershipIds: members.slice(3).map((member) => member.membershipId) }]);
    const approvedSeason = seasonResponse([
      { id: "crew-1", name: "North", membershipIds: members.slice(0, 3).map((member) => member.membershipId) },
      { id: "crew-2", name: "South", membershipIds: members.slice(3).map((member) => member.membershipId) },
    ]);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify(initialSeason), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(pendingProposal), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposal: { id: "proposal-1", status: "approved" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(approvedProposal), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(approvedSeason), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ saved: true }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(approvedSeason), { status: 200 }));

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    // Generous timeout: under coverage the proposal fetch can take >1s.
    await screen.findByRole("button", { name: "Approve proposal North" }, { timeout: 5000 });
    await user.click(screen.getByRole("button", { name: "Approve proposal North" }));
    const crewName = await screen.findByDisplayValue("North", {}, { timeout: 5000 });
    expect(crewName).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save Season setup" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    expect(JSON.parse(String(fetchMock.mock.calls[5][1]?.body)).crews).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "North" }),
    ]));
  });
});
