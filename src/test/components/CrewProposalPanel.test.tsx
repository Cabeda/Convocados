import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import CrewProposalPanel from "~/components/CrewProposalPanel";

/** The client reads the body as JSON only when the response says so. */
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CrewProposalPanel", () => {
  it("lets a Season participant submit a named Crew with selected members", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({ canPropose: true, canReview: false, proposerMembershipId: "membership-0", candidates: [
        { membershipId: "membership-0", name: "Player 0" },
        { membershipId: "membership-1", name: "Player 1" },
        { membershipId: "membership-2", name: "Player 2" },
        { membershipId: "membership-3", name: "Player 3" },
      ], proposals: [] }))
      .mockResolvedValueOnce(json({ players: [{ name: "Player 4", userId: "user-4", gamesPlayed: 3 }] }))
      .mockResolvedValueOnce(json({ proposal: { id: "proposal-1", name: "North", status: "pending" } }, 201));

    renderWithTheme(<CrewProposalPanel eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "Propose a Crew" });
    await user.type(screen.getByLabelText("Crew name"), "North");
    const memberPicker = screen.getByLabelText("Select Crew members");
    await user.click(memberPicker);
    await user.click(await screen.findByRole("option", { name: "Player 1" }));
    await user.click(memberPicker);
    await user.click(await screen.findByRole("option", { name: "Player 4" }));
    await user.click(screen.getByRole("button", { name: "Submit Crew proposal" }));

    await screen.findByText("Crew proposal submitted for approval.");
    expect(fetchMock.mock.calls[2][0]).toBe("/api/events/event-1/seasons/season-1/crew-proposals");
    expect(JSON.parse(String(fetchMock.mock.calls[2][1]?.body))).toEqual({
      name: "North",
      members: [{ membershipId: "membership-0" }, { membershipId: "membership-1" }, { userId: "user-4" }],
    });
  });

  it("lets an Event admin approve a pending proposal", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({
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
      }))
      .mockResolvedValueOnce(json({ proposal: { id: "proposal-1", status: "approved" } }))
      .mockResolvedValueOnce(json({
        canPropose: false,
        canReview: true,
        candidates: [],
        proposals: [{
          id: "proposal-1",
          name: "North",
          status: "approved",
          proposerName: "Player 0",
          memberNames: ["Player 0", "Player 1", "Player 2"],
        }],
      }));

    renderWithTheme(<CrewProposalPanel eventId="event-1" seasonId="season-1" />);
    await screen.findByText("North");
    await user.click(screen.getByRole("button", { name: "Approve proposal North" }));

    expect(fetchMock.mock.calls[1][0]).toBe("/api/events/event-1/seasons/season-1/crew-proposals/proposal-1");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ decision: "approve" });
    expect(await screen.findByText("Approved")).toBeInTheDocument();
  });
});


describe("Captain nominations", () => {
  const nomination = {
    id: "proposal-9",
    name: "North",
    kind: "add",
    status: "pending",
    targetCrewId: "crew-1",
    targetCrewName: "North",
    captainNomination: true,
    awaitingMyAcceptance: true,
    proposerName: "Owner",
    memberNames: ["Player 1"],
  };

  it("lets the nominated captain accept the nomination", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({ canPropose: false, canReview: false, candidates: [], proposals: [nomination] }))
      .mockResolvedValueOnce(json({ proposal: { ...nomination, status: "approved" } }))
      .mockResolvedValueOnce(json({ canPropose: false, canReview: false, candidates: [], proposals: [{ ...nomination, status: "approved", awaitingMyAcceptance: false }] }));

    renderWithTheme(<CrewProposalPanel eventId="event-1" seasonId="season-1" />);
    await screen.findByText("Captain nomination — North");
    expect(screen.getByText("Proposed by Owner")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Accept captaincy" }));

    expect(fetchMock.mock.calls[1][0]).toBe("/api/events/event-1/seasons/season-1/crew-proposals/proposal-9");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ decision: "accept" });
  });

  it("offers an admin only the cancel action on a nomination", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(json({
      canPropose: false, canReview: true, candidates: [], proposals: [{ ...nomination, awaitingMyAcceptance: false }],
    }));

    renderWithTheme(<CrewProposalPanel eventId="event-1" seasonId="season-1" />);
    await screen.findByText("Captain nomination — North");

    expect(screen.queryByRole("button", { name: "Approve proposal North" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject proposal North" })).toBeInTheDocument();
  });
});

describe("Captain's crew changes", () => {
  const captainOf = {
    crewId: "crew-1",
    crewName: "North",
    members: [{ membershipId: "membership-1", name: "Player 1" }],
  };

  it("lets a captain propose an addition for their own crew", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({
        canPropose: false,
        canReview: false,
        candidates: [{ membershipId: "membership-9", name: "Player 9" }],
        proposals: [],
        captainOf,
      }))
      .mockResolvedValueOnce(json({ proposal: { id: "proposal-2", status: "pending" } }, 201));

    renderWithTheme(<CrewProposalPanel eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "Captain tools" });
    await user.click(screen.getByLabelText("Player name"));
    await user.click(await screen.findByRole("option", { name: "Player 9" }));
    await user.click(screen.getByRole("button", { name: "Add player" }));

    expect(fetchMock.mock.calls[1][0]).toBe("/api/events/event-1/seasons/season-1/crew-proposals");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
      action: "add",
      targetCrewId: "crew-1",
      membershipIds: ["membership-9"],
    });
    expect(await screen.findByText("Sent to the organizer for approval.")).toBeInTheDocument();
  });

  it("gives a participant who is not a captain no captain tools", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(json({
      canPropose: true,
      canReview: false,
      proposerMembershipId: "membership-1",
      candidates: [{ membershipId: "membership-1", name: "Player 1" }],
      proposals: [],
      captainOf: null,
    }));

    renderWithTheme(<CrewProposalPanel eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "Propose a Crew" });

    expect(screen.queryByRole("button", { name: "Add player" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Captain tools" })).not.toBeInTheDocument();
  });
});

describe("Crew proposal invitations", () => {
  it("invites an unregistered email from the proposal picker", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(json({
        canPropose: true,
        canReview: false,
        proposerMembershipId: "membership-0",
        candidates: [{ membershipId: "membership-0", name: "Player 0" }],
        proposals: [],
      }))
      .mockResolvedValueOnce(json({ players: [] }))
      .mockResolvedValueOnce(json({ invited: true, email: "new@example.test" }, 202));

    renderWithTheme(<CrewProposalPanel eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "Propose a Crew" });
    await user.type(screen.getByLabelText("Invite by email (optional)"), "new@example.test");
    await user.click(screen.getByRole("button", { name: "Invite new@example.test by email" }));

    expect(await screen.findByText("Invite sent to new@example.test. Share the link to get them in.")).toBeInTheDocument();
  });
});
