import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import SeasonPage from "~/components/SeasonPage";
import SeasonListPage from "~/components/SeasonListPage";
import CrewProposalPanel from "~/components/CrewProposalPanel";
import { LeaderboardTables, type LeaderboardPayload } from "~/components/LeaderboardTables";

const emptyProposalPanel = { canPropose: false, canReview: false, candidates: [], proposals: [] };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SeasonPage conditional states", () => {
  it("shows a spinner while the Season is loading", async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
  });

  it("surfaces a season load error", async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes("crew-proposals")) {
        return Promise.resolve(new Response(JSON.stringify(emptyProposalPanel), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ error: "Boom" }), { status: 500 }));
    });

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);

    expect(await screen.findByText("Boom")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recommend Crews" })).not.toBeInTheDocument();
  });

  it("asks the viewer to sign in when the Season request is unauthorized", async () => {
    vi.mocked(fetch).mockImplementation((input) => {
      const url = String(input);
      if (url.includes("crew-proposals")) {
        return Promise.resolve(new Response(JSON.stringify(emptyProposalPanel), { status: 200 }));
      }
      return Promise.resolve(new Response(JSON.stringify({}), { status: 401 }));
    });

    renderWithTheme(<SeasonPage eventId="event-1" seasonId="season-1" />);

    expect(await screen.findByText("Sign in as the event owner or an admin to manage Crews.")).toBeInTheDocument();
  });
});

describe("SeasonListPage conditional states", () => {
  it("shows a spinner while seasons load", async () => {
    vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
    renderWithTheme(<SeasonListPage eventId="event-1" />);
    expect(screen.getAllByRole("progressbar").length).toBeGreaterThan(0);
  });

  it("surfaces a load failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Nope" }), { status: 500 }));
    renderWithTheme(<SeasonListPage eventId="event-1" />);
    expect(await screen.findByText("Nope")).toBeInTheDocument();
  });

  it("shows the locked notice without season data", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ locked: true }), { status: 200 }));
    renderWithTheme(<SeasonListPage eventId="event-1" />);
    expect(await screen.findByText("This event is password-protected.")).toBeInTheDocument();
  });
});

describe("CrewProposalPanel conditional states", () => {
  it("renders nothing when the viewer has no proposal access", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify(emptyProposalPanel), { status: 200 }));
    renderWithTheme(<CrewProposalPanel eventId="event-1" seasonId="season-1" />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.queryByRole("heading", { name: "Propose a Crew" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit Crew proposal" })).not.toBeInTheDocument();
  });

  it("renders nothing when the proposals request is forbidden", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }));
    renderWithTheme(<CrewProposalPanel eventId="event-1" seasonId="season-1" />);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(vi.mocked(fetch)).toHaveBeenCalledWith("/api/events/event-1/seasons/season-1/crew-proposals");
    expect(screen.queryByRole("heading", { name: "Propose a Crew" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit Crew proposal" })).not.toBeInTheDocument();
  });
});

describe("LeaderboardTables conditional states", () => {
  const data: LeaderboardPayload = {
    scope: { type: "season", seasonId: "season-1", name: "Spring League", startsAt: null, endsAt: null },
    gamesCount: 4,
    players: [],
    crews: [],
  };

  it("shows the loading message when there is no data yet", () => {
    renderWithTheme(
      <LeaderboardTables data={null} loading selectedScopeId="all" seasonOptions={[]} onScopeChange={vi.fn()} />,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
  });

  it("explains an empty player league", () => {
    renderWithTheme(
      <LeaderboardTables data={data} loading={false} selectedScopeId="all" seasonOptions={[]} onScopeChange={vi.fn()} />,
    );
    expect(screen.getByText("No Crew standings are available for this scope.")).toBeInTheDocument();
  });
});
