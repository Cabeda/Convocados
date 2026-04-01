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

/** Helper: set up fetch mock + window.location for submission tests */
function setupSubmission(id = "test-event") {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    json: async () => ({ id }),
  });
  delete (window as any).location;
  (window as any).location = { href: "", pathname: "/", search: "" };
}

/** Helper: get the submitted request body */
function getSubmittedBody(): Record<string, unknown> {
  return JSON.parse(mockFetch.mock.calls[0][1].body);
}

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
    setupSubmission("new-event-123");

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

    const body = getSubmittedBody();
    expect(body.title).toBe("Test Game");
    expect(body.sport).toBe("football-5v5");

    await waitFor(() => {
      expect(window.location.href).toBe("/events/new-event-123");
    });
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

  it("has a randomize title button", () => {
    renderWithTheme(<CreateEventForm />);
    expect(screen.getByLabelText(/Surprise me/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Recurrence dropdown — visibility & presets
// ---------------------------------------------------------------------------
describe("CreateEventForm — recurrence dropdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("shows recurrence dropdown without expanding advanced options", () => {
    renderWithTheme(<CreateEventForm />);
    // Recurrence is in the main form, not behind the accordion
    expect(screen.getByText(/Does not repeat/i)).toBeInTheDocument();
  });

  it("defaults to 'Does not repeat'", () => {
    renderWithTheme(<CreateEventForm />);
    expect(screen.getByText(/Does not repeat/i)).toBeInTheDocument();
  });

  it("shows all recurrence presets in dropdown", async () => {
    const user = userEvent.setup();
    renderWithTheme(<CreateEventForm />);

    const recurrenceSelect = screen.getAllByText(/Does not repeat/i)[0];
    await user.click(recurrenceSelect);

    await waitFor(() => {
      expect(screen.getByText(/Daily/i)).toBeInTheDocument();
      expect(screen.getByText(/Custom\.\.\./i)).toBeInTheDocument();
    });
  });

  it("opens custom recurrence dialog when Custom is selected", async () => {
    const user = userEvent.setup();
    renderWithTheme(<CreateEventForm />);

    const recurrenceSelect = screen.getAllByText(/Does not repeat/i)[0];
    await user.click(recurrenceSelect);

    const customOption = await screen.findByText(/Custom\.\.\./i);
    await user.click(customOption);

    await waitFor(() => {
      expect(screen.getByText(/Custom recurrence/i)).toBeInTheDocument();
    });
  });

  it("custom dialog has Done button (not Save)", async () => {
    const user = userEvent.setup();
    renderWithTheme(<CreateEventForm />);

    const recurrenceSelect = screen.getAllByText(/Does not repeat/i)[0];
    await user.click(recurrenceSelect);
    await user.click(await screen.findByText(/Custom\.\.\./i));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Done/i })).toBeInTheDocument();
    });
  });
});

// ---------------------------------------------------------------------------
// Recurrence submission — all presets
// ---------------------------------------------------------------------------
describe("CreateEventForm — recurrence submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockReset();
  });

  it("sends isRecurring=false when 'Does not repeat' is selected (default)", async () => {
    const user = userEvent.setup();
    setupSubmission("no-recurrence");

    renderWithTheme(<CreateEventForm />);

    const titleInput = screen.getByLabelText(/Game title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "One-off Game");

    await user.click(screen.getByRole("button", { name: /Create game/i }));

    await waitFor(() => {
      const body = getSubmittedBody();
      expect(body.isRecurring).toBe(false);
      expect(body.recurrenceFreq).toBeNull();
      expect(body.recurrenceInterval).toBeNull();
      expect(body.recurrenceByDay).toBeNull();
    });
  });

  it("sends daily recurrence when Daily preset selected", async () => {
    const user = userEvent.setup();
    setupSubmission("daily-event");

    renderWithTheme(<CreateEventForm />);

    // Select Daily
    const recurrenceSelect = screen.getAllByText(/Does not repeat/i)[0];
    await user.click(recurrenceSelect);
    await user.click(await screen.findByText(/Daily/i));

    const titleInput = screen.getByLabelText(/Game title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Daily Game");

    await user.click(screen.getByRole("button", { name: /Create game/i }));

    await waitFor(() => {
      const body = getSubmittedBody();
      expect(body.isRecurring).toBe(true);
      expect(body.recurrenceFreq).toBe("daily");
      expect(body.recurrenceInterval).toBe(1);
      expect(body.recurrenceByDay).toBeNull();
    });
  });

  it("sends weekly recurrence with correct byDay when Weekly preset selected", async () => {
    const user = userEvent.setup();
    setupSubmission("weekly-event");

    renderWithTheme(<CreateEventForm />);

    // Select Weekly
    const recurrenceSelect = screen.getAllByText(/Does not repeat/i)[0];
    await user.click(recurrenceSelect);

    // Find the Weekly option (it includes the day name)
    const weeklyOption = await screen.findByText(/^Weekly on/i);
    await user.click(weeklyOption);

    const titleInput = screen.getByLabelText(/Game title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Weekly Game");

    await user.click(screen.getByRole("button", { name: /Create game/i }));

    await waitFor(() => {
      const body = getSubmittedBody();
      expect(body.isRecurring).toBe(true);
      expect(body.recurrenceFreq).toBe("weekly");
      expect(body.recurrenceInterval).toBe(1);
      // byDay should be a valid 2-letter day code
      expect(body.recurrenceByDay).toMatch(/^(MO|TU|WE|TH|FR|SA|SU)$/);
    });
  });

  it("sends monthly recurrence when Monthly preset selected", async () => {
    const user = userEvent.setup();
    setupSubmission("monthly-event");

    renderWithTheme(<CreateEventForm />);

    // Select Monthly
    const recurrenceSelect = screen.getAllByText(/Does not repeat/i)[0];
    await user.click(recurrenceSelect);

    const monthlyOption = await screen.findByText(/^Monthly on/i);
    await user.click(monthlyOption);

    const titleInput = screen.getByLabelText(/Game title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Monthly Game");

    await user.click(screen.getByRole("button", { name: /Create game/i }));

    await waitFor(() => {
      const body = getSubmittedBody();
      expect(body.isRecurring).toBe(true);
      expect(body.recurrenceFreq).toBe("monthly");
      expect(body.recurrenceInterval).toBe(1);
      expect(body.recurrenceByDay).toBeNull();
    });
  });

  it("sends yearly recurrence when Annually preset selected", async () => {
    const user = userEvent.setup();
    setupSubmission("yearly-event");

    renderWithTheme(<CreateEventForm />);

    // Select Annually
    const recurrenceSelect = screen.getAllByText(/Does not repeat/i)[0];
    await user.click(recurrenceSelect);

    const yearlyOption = await screen.findByText(/^Annually on/i);
    await user.click(yearlyOption);

    const titleInput = screen.getByLabelText(/Game title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Yearly Game");

    await user.click(screen.getByRole("button", { name: /Create game/i }));

    await waitFor(() => {
      const body = getSubmittedBody();
      expect(body.isRecurring).toBe(true);
      expect(body.recurrenceFreq).toBe("yearly");
      expect(body.recurrenceInterval).toBe(1);
      expect(body.recurrenceByDay).toBeNull();
    });
  });

  it("shows recurrence info alert when any recurrence is selected", async () => {
    const user = userEvent.setup();
    renderWithTheme(<CreateEventForm />);

    // No alert initially
    expect(screen.queryByText(/player list resets/i)).not.toBeInTheDocument();

    // Select Daily
    const recurrenceSelect = screen.getAllByText(/Does not repeat/i)[0];
    await user.click(recurrenceSelect);
    await user.click(await screen.findByText(/Daily/i));

    await waitFor(() => {
      expect(screen.getByText(/player list resets/i)).toBeInTheDocument();
    });
  });

  it("can switch back to 'Does not repeat' after selecting a recurrence", async () => {
    const user = userEvent.setup();
    setupSubmission("switched-back");

    renderWithTheme(<CreateEventForm />);

    // Select Daily first
    let recurrenceSelect = screen.getAllByText(/Does not repeat/i)[0];
    await user.click(recurrenceSelect);
    await user.click(await screen.findByText(/Daily/i));

    // Now switch back to none
    recurrenceSelect = screen.getAllByText(/Daily/i)[0];
    await user.click(recurrenceSelect);
    await user.click(await screen.findByText(/Does not repeat/i));

    const titleInput = screen.getByLabelText(/Game title/i);
    await user.clear(titleInput);
    await user.type(titleInput, "Switched Back");

    await user.click(screen.getByRole("button", { name: /Create game/i }));

    await waitFor(() => {
      const body = getSubmittedBody();
      expect(body.isRecurring).toBe(false);
      expect(body.recurrenceFreq).toBeNull();
    });
  });
});
