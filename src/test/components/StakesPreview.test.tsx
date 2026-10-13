import { describe, expect, it, afterEach } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { StakesPreview } from "~/components/StakesPreview";
import type { StakesScenario } from "~/lib/stakesPreview";

const scenario: StakesScenario = {
  outcome: "teamOne",
  players: [],
  crews: [
    { crewId: "c1", name: "Sharks", roundScore: 2, membersInLineup: 2, positionBefore: 2, positionAfter: 1, passed: 1 },
    { crewId: "c2", name: "Wolves", roundScore: 0, membersInLineup: 1, positionBefore: 1, positionAfter: 2, passed: -1 },
  ],
};

afterEach(cleanup);

describe("StakesPreview (Crew race strip)", () => {
  it("renders the Crew race sorted by projected position with movement and round scores", () => {
    renderWithTheme(
      <StakesPreview seasonName="Season 1" roundAvailable roundsCounted={3} scenario={scenario} />,
    );
    const strip = screen.getByTestId("stakes-preview");
    expect(strip).toHaveTextContent("Sharks");
    expect(strip).toHaveTextContent("2 pts");
    expect(strip).toHaveTextContent("#1");
    expect(strip).toHaveTextContent("▲1");
    expect(strip).toHaveTextContent("Wolves");
    expect(strip).toHaveTextContent("▼1");
  });

  it("prefers the live round score derived client-side while dragging", () => {
    renderWithTheme(
      <StakesPreview seasonName="Season 1" roundAvailable roundsCounted={3} scenario={scenario} liveRoundScore={{ c1: 3 }} />,
    );
    expect(screen.getByTestId("stakes-preview")).toHaveTextContent("3 pts");
  });

  it("explains when the Season has no rounds left", () => {
    renderWithTheme(
      <StakesPreview seasonName="Season 1" roundAvailable={false} roundsCounted={8} scenario={null} />,
    );
    expect(screen.getByTestId("stakes-preview-no-round")).toHaveTextContent(/rounds are played/);
  });

  it("renders nothing before the projection arrives", () => {
    renderWithTheme(
      <StakesPreview seasonName="Season 1" roundAvailable roundsCounted={3} scenario={null} />,
    );
    expect(screen.queryByTestId("stakes-preview")).not.toBeInTheDocument();
  });
});
