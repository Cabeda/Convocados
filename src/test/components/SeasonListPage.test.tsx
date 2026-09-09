import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import SeasonListPage from "~/components/SeasonListPage";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("SeasonListPage", () => {
  it("lists current and past Seasons with links to their details", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ seasons: [
      {
        id: "season-current",
        name: "September Season",
        status: "registration",
        startsAt: "2026-09-01T00:00:00.000Z",
        memberCount: 6,
        currentMembership: null,
      },
      {
        id: "season-past",
        name: "Summer Season",
        status: "completed",
        startsAt: "2026-06-01T00:00:00.000Z",
        memberCount: 8,
        currentMembership: null,
      },
    ] }), { status: 200 }));

    renderWithTheme(<SeasonListPage eventId="event-1" />);

    expect(await screen.findByRole("heading", { name: "Seasons" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to game" })).toHaveAttribute("href", "/events/event-1");
    expect(screen.getByText("Current seasons")).toBeInTheDocument();
    expect(screen.getByText("Past seasons")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /September Season/ })).toHaveAttribute(
      "href", "/events/event-1/seasons/season-current",
    );
    expect(screen.getByRole("link", { name: /Summer Season/ })).toHaveAttribute(
      "href", "/events/event-1/seasons/season-past",
    );
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("does not reveal Season data when the Event is locked", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ locked: true, hasPassword: true }), { status: 200 }));

    renderWithTheme(<SeasonListPage eventId="event-1" />);

    expect(await screen.findByText("This event is password-protected.")).toBeInTheDocument();
    expect(screen.queryByText("Past seasons")).not.toBeInTheDocument();
  });

  it("shows the start-new-season control only to managers", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ seasons: [], canManage: false }), { status: 200 }));

    renderWithTheme(<SeasonListPage eventId="event-1" />);

    expect(await screen.findByText("No Seasons yet.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Start a new season" })).not.toBeInTheDocument();
  });

  it("lets a manager open the create-season form", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ seasons: [], canManage: true }), { status: 200 }));

    renderWithTheme(<SeasonListPage eventId="event-1" />);

    const startButton = await screen.findByRole("button", { name: "Start a new season" });
    startButton.click();

    expect(await screen.findByLabelText("Season name")).toBeInTheDocument();
    expect(screen.getByLabelText("Registration opens")).toBeInTheDocument();
    expect(screen.getByLabelText("Registration closes")).toBeInTheDocument();
  });
});
