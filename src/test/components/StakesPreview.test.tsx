import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { StakesPreview } from "~/components/StakesPreview";

const preview = {
  seasonId: "s1",
  seasonName: "Season 1",
  rankEnabled: true,
  roundAvailable: true,
  roundsCounted: 0,
  edges: [0, 75, 102, 107, 118, 213],
  lineup: [
    { name: "Ana", side: "teamOne", crewId: "c1", crewName: "Sharks", participant: true },
    { name: "Bia", side: "teamTwo", crewId: "c1", crewName: "Sharks", participant: true },
  ],
  scenarios: [
    {
      outcome: "teamOne",
      players: [
        { name: "Ana", side: "teamOne", crewId: "c1", crewName: "Sharks", contribution: 3, rpDelta: 12, rankBefore: 100, rankAfter: 112, tierBefore: 2, tierAfter: 2, provisional: false, positionBefore: 2, positionAfter: 1, passed: 1 },
        { name: "Bia", side: "teamTwo", crewId: "c1", crewName: "Sharks", contribution: 0, rpDelta: -12, rankBefore: 112, rankAfter: 100, tierBefore: 2, tierAfter: 2, provisional: false, positionBefore: 1, positionAfter: 2, passed: -1 },
      ],
      crews: [{ crewId: "c1", name: "Sharks", roundScore: 2, membersInLineup: 2, positionBefore: 1, positionAfter: 1, passed: 0 }],
    },
    { outcome: "draw", players: [], crews: [{ crewId: "c1", name: "Sharks", roundScore: 1, membersInLineup: 2, positionBefore: 1, positionAfter: 1, passed: 0 }] },
    { outcome: "teamTwo", players: [], crews: [{ crewId: "c1", name: "Sharks", roundScore: 2, membersInLineup: 2, positionBefore: 1, positionAfter: 1, passed: 0 }] },
  ],
};

function stubFetch(body: unknown, ok = true) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status: ok ? 200 : 403, headers: { "content-type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("StakesPreview", () => {
  it("renders nothing for a non-participant or when no Season is active", async () => {
    stubFetch({ active: false });
    renderWithTheme(
      <StakesPreview eventId="e1" teamOne={["Ana"]} teamTwo={["Bia"]} teamOneName="Reds" teamTwoName="Blues" />,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.queryByTestId("stakes-preview")).not.toBeInTheDocument();
  });

  it("shows Crew associations and projected points when expanded", async () => {
    stubFetch({ active: true, preview });
    renderWithTheme(
      <StakesPreview eventId="e1" teamOne={["Ana"]} teamTwo={["Bia"]} teamOneName="Reds" teamTwoName="Blues" />,
    );

    expect(await screen.findByText("What's at stake")).toBeInTheDocument();
    expect(screen.getByText("Season 1")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /What's at stake/ }));

    expect(await screen.findByText("Reds win")).toBeInTheDocument();
    expect(screen.getByText("Blues win")).toBeInTheDocument();
    // Crew association chip + crew standings row both name the Crew.
    expect(screen.getAllByText("Sharks").length).toBeGreaterThanOrEqual(2);
    // Ana wins in the first scenario: +3 contribution and +12 RP.
    expect(screen.getByText("3 pts")).toBeInTheDocument();
    expect(screen.getByText("+12 RP")).toBeInTheDocument();
  });

  it("explains when the Season has no rounds left", async () => {
    stubFetch({ active: true, preview: { ...preview, roundAvailable: false, roundsCounted: 8 } });
    renderWithTheme(
      <StakesPreview eventId="e1" teamOne={["Ana"]} teamTwo={["Bia"]} teamOneName="Reds" teamTwoName="Blues" />,
    );
    expect(await screen.findByText("What's at stake")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /What's at stake/ }));
    expect(await screen.findByText(/rounds are played/)).toBeInTheDocument();
  });

  it("refetches when the lineups change", async () => {
    const fetchMock = stubFetch({ active: true, preview });
    const { rerender } = renderWithTheme(
      <StakesPreview eventId="e1" teamOne={["Ana"]} teamTwo={["Bia"]} teamOneName="Reds" teamTwoName="Blues" />,
    );
    await screen.findByText("What's at stake");
    rerender(
      <StakesPreview eventId="e1" teamOne={["Ana", "Cara"]} teamTwo={["Bia"]} teamOneName="Reds" teamTwoName="Blues" />,
    );
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
  });
});
