import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { screen, waitFor, cleanup, fireEvent } from "@testing-library/react";
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
      startsAt: null,
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
      startsAt: null,
      crews: [
        { name: "North", membershipIds: expect.not.arrayContaining(["membership-0"]) },
        { name: "Crew 2", membershipIds: expect.arrayContaining(["membership-0"]) },
      ],
    });
    expect(await screen.findByText("Season setup saved.")).toBeInTheDocument();
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
    expect(screen.getByRole("link", { name: "View leaderboard" }))
      .toHaveAttribute("href", "/events/event-1/history?seasonId=season-1");
  });

  it("enables Start season once there are 3 Crews and 9 participants", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    const nine = Array.from({ length: 9 }, (_, i) => ({
      membershipId: `m-${i}`, eventPlayerId: `p-${i}`, name: `P${i}`, rating: 1000, crewId: `crew-${Math.floor(i / 3)}`,
    }));
    const ready = {
      season: {
        id: "season-1", name: "September Season", status: "registration", startsAt: null,
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
    await screen.findByRole("button", { name: "Approve proposal North" });
    await user.click(screen.getByRole("button", { name: "Approve proposal North" }));
    const crewName = await screen.findByDisplayValue("North");
    expect(crewName).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Save Season setup" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(7));
    expect(JSON.parse(String(fetchMock.mock.calls[5][1]?.body)).crews).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "North" }),
    ]));
  });
});
