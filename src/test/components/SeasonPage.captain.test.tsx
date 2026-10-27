import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import SeasonPage from "~/components/SeasonPage";

// The typed client parses JSON by content type; a bare `new Response(body)` is text/plain.
const JSON_HEADERS = { "Content-Type": "application/json" };

const emptyProposalPanel = { canPropose: false, canReview: false, candidates: [], proposals: [] };

/**
 * The reported bug: the owner picks a captain in the crew editor, the page
 * refetches, and nothing on the roster says a captain was chosen. A nomination
 * is pending until the nominee accepts, so `captainMembershipId` stays null —
 * the UI has to show that on the player row instead of looking like it dropped
 * the choice.
 */
function seasonPayload(
  crews: Array<{ id: string; name: string; captainMembershipId: string | null; captainName: string | null }>,
) {
  return {
    season: {
      id: "season-1",
      name: "Old Bones",
      status: "registration",
      registrationOpen: true,
      registrationOpensAt: "2026-01-01T00:00:00.000Z",
      registrationClosesAt: "2026-02-01T00:00:00.000Z",
      // Present ⇒ the viewer manages crews (SeasonPage: `isManager`).
      activeMembers: [
        { membershipId: "m1", name: "Me" },
        { membershipId: "m2", name: "Luis" },
      ],
      crews: crews.map((crew, index) => ({
        ...crew,
        sortOrder: index,
        members: [
          { membershipId: "m1", name: "Me" },
          { membershipId: "m2", name: "Luis" },
        ],
      })),
      viewerMembership: { id: "m1", status: "active", eventPlayerId: "player-1" },
    },
  };
}

describe("season captain selection", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the chosen captain on the player row while the nomination is pending", async () => {
    const posted: unknown[] = [];
    vi.mocked(fetch).mockImplementation((input, init) => {
      const url = String(input);
      if (url.includes("crew-proposals")) {
        if (init?.method === "POST") {
          posted.push(JSON.parse(String(init.body)));
          return Promise.resolve(new Response(JSON.stringify({ proposal: { id: "p1" } }), { status: 201, headers: JSON_HEADERS }));
        }
        return Promise.resolve(new Response(JSON.stringify(emptyProposalPanel), { status: 200, headers: JSON_HEADERS }));
      }
      // The real backend keeps `captainMembershipId` null until the nominee
      // accepts; the mock must not be kinder than the API.
      return Promise.resolve(new Response(JSON.stringify(seasonPayload([
        { id: "crew-1", name: "Old Bones", captainMembershipId: null, captainName: null },
      ])), { status: 200, headers: JSON_HEADERS }));
    });

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);

    const select = await screen.findByLabelText("Captain");
    fireEvent.mouseDown(select);
    fireEvent.click(await screen.findByRole("option", { name: "Luis" }));

    await waitFor(() => {
      expect(posted).toContainEqual({ action: "captain", crewId: "crew-1", membershipId: "m2" });
    });

    // The symptom: after the refetch the choice is nowhere on the row. A
    // nomination is pending until Luis accepts, so the row must say so.
    await waitFor(() => {
      expect(screen.getAllByLabelText("awaiting acceptance: Luis").length).toBeGreaterThan(0);
    });
  });
});
