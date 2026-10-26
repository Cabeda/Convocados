import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import SeasonPage from "~/components/SeasonPage";

const season = {
  id: "season-1",
  name: "September Season",
  status: "registration",
  registrationOpensAt: "2026-09-01T00:00:00.000Z",
  registrationClosesAt: "2026-09-30T00:00:00.000Z",
  viewerEventPlayerId: null,
  viewerMembership: null,
  registrationOpen: true,
  hasOtherLiveSeason: false,
  crews: [],
  activeMembers: [{ membershipId: "membership-1", eventPlayerId: "player-1", name: "Player 1", rating: 1000, crewId: null }],
};

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const body = url.includes("crew-proposals")
      ? { canPropose: false, canReview: false, candidates: [], proposals: [] }
      : { season };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SeasonPage API calls", () => {
  it("loads the Season through the typed client, query included", async () => {
    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" crewInviteToken="tok en" />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/events/event-1/seasons/season-1?crewInviteToken=tok+en",
        { method: "GET" },
      );
    });
  });

  it("claims a Crew invite through the typed client with a JSON body", async () => {
    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" crewInviteToken="tok" />);

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        "/api/events/event-1/seasons/season-1/crew-proposals",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "claim-invite", token: "tok" }),
          signal: expect.any(AbortSignal),
        },
      );
    });
  });
});
