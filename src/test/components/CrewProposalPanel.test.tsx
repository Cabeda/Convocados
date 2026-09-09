import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import CrewProposalPanel from "~/components/CrewProposalPanel";

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
      .mockResolvedValueOnce(new Response(JSON.stringify({ canPropose: true, canReview: false, proposerMembershipId: "membership-0", candidates: [
        { membershipId: "membership-0", name: "Player 0" },
        { membershipId: "membership-1", name: "Player 1" },
        { membershipId: "membership-2", name: "Player 2" },
        { membershipId: "membership-3", name: "Player 3" },
      ], proposals: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ players: [{ name: "Player 4", userId: "user-4", gamesPlayed: 3 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposal: { id: "proposal-1", name: "North", status: "pending" } }), { status: 201 }));

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
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ proposal: { id: "proposal-1", status: "approved" } }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
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
      }), { status: 200 }));

    renderWithTheme(<CrewProposalPanel eventId="event-1" seasonId="season-1" />);
    await screen.findByText("North");
    await user.click(screen.getByRole("button", { name: "Approve proposal North" }));

    expect(fetchMock.mock.calls[1][0]).toBe("/api/events/event-1/seasons/season-1/crew-proposals/proposal-1");
    expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({ decision: "approve" });
    expect(await screen.findByText("Approved")).toBeInTheDocument();
  });
});


describe("Crew proposal invitations", () => {
  it("invites an unregistered email from the proposal picker", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.mocked(fetch);
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({
        canPropose: true,
        canReview: false,
        proposerMembershipId: "membership-0",
        candidates: [{ membershipId: "membership-0", name: "Player 0" }],
        proposals: [],
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ players: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ invited: true, email: "new@example.test" }), { status: 202 }));

    renderWithTheme(<CrewProposalPanel eventId="event-1" seasonId="season-1" />);
    await screen.findByRole("heading", { name: "Propose a Crew" });
    await user.type(screen.getByLabelText("Invite by email (optional)"), "new@example.test");
    await user.click(screen.getByRole("button", { name: "Invite new@example.test by email" }));

    expect(await screen.findByText("Invite sent to new@example.test. Share the link to get them in.")).toBeInTheDocument();
  });
});
