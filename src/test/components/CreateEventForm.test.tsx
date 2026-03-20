import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import CreateEventForm from "~/components/CreateEventForm";

// Mock __APP_VERSION__
(globalThis as any).__APP_VERSION__ = "0.0.0-test";

// Mock auth.client (imported by ResponsiveLayout)
vi.mock("~/lib/auth.client", () => ({
  useSession: () => ({ data: null, isPending: false }),
  signOut: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

afterEach(() => cleanup());

describe("CreateEventForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("renders the create game heading", () => {
    renderWithTheme(<CreateEventForm />);
    expect(screen.getByText("Create a Game")).toBeInTheDocument();
  });

  it("renders the form with required fields", () => {
    renderWithTheme(<CreateEventForm />);
    expect(screen.getByLabelText(/Game title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Date & time/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create game/i })).toBeInTheDocument();
  });

  it("renders sport selector", () => {
    renderWithTheme(<CreateEventForm />);
    const sportElements = screen.getAllByText(/Sport/i);
    expect(sportElements.length).toBeGreaterThanOrEqual(1);
  });

  it("submits the form and redirects on success", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ id: "new-event-123" }),
    });

    const originalHref = window.location.href;
    delete (window as any).location;
    (window as any).location = { href: "", pathname: "/", search: "" };

    renderWithTheme(<CreateEventForm />);

    const titleInput = screen.getByLabelText(/Game title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Test Game");

    const submitBtn = screen.getByRole("button", { name: /Create game/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/events", expect.objectContaining({
        method: "POST",
      }));
    });

    const callArgs = mockFetch.mock.calls[0];
    const body = JSON.parse(callArgs[1].body);
    expect(body.title).toBe("Test Game");
    expect(body.sport).toBe("football-5v5");

    await waitFor(() => {
      expect(window.location.href).toBe("/events/new-event-123");
    });

    (window as any).location = { href: originalHref, pathname: "/", search: "" };
  });

  it("shows error when API returns error", async () => {
    const user = userEvent.setup();
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "Title is required." }),
    });

    renderWithTheme(<CreateEventForm />);

    const titleInput = screen.getByLabelText(/Game title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Test");

    const submitBtn = screen.getByRole("button", { name: /Create game/i });
    await user.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByText("Title is required.")).toBeInTheDocument();
    });
  });

  it("shows advanced options when accordion is expanded", async () => {
    const user = userEvent.setup();
    renderWithTheme(<CreateEventForm />);

    await user.click(screen.getByText(/Advanced options/i));

    await waitFor(() => {
      expect(screen.getByLabelText(/Location/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/Max players/i)).toBeInTheDocument();
    });
  });

  it("shows recurrence options when recurring toggle is enabled", async () => {
    const user = userEvent.setup();
    renderWithTheme(<CreateEventForm />);

    await user.click(screen.getByText(/Advanced options/i));

    const recurringSwitch = await screen.findByLabelText(/Recurring game/i);
    await user.click(recurringSwitch);

    await waitFor(() => {
      expect(screen.getByLabelText(/Every/i)).toBeInTheDocument();
      const freqElements = screen.getAllByText(/Frequency/i);
      expect(freqElements.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("has a randomize title button", () => {
    renderWithTheme(<CreateEventForm />);
    expect(screen.getByLabelText(/Surprise me/i)).toBeInTheDocument();
  });
});
