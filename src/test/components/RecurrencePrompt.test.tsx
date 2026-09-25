/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { screen, cleanup, waitFor, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { RecurrencePrompt } from "~/components/RecurrencePrompt";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("RecurrencePrompt", () => {
  it("does not render before the game is wrapped up", () => {
    renderWithTheme(<RecurrencePrompt eventId="e1" isRecurring={false} />);
    expect(screen.queryByTestId("recurrence-prompt")).not.toBeInTheDocument();
  });

  it("offers the owner a weekly repeat once wrap-up is complete", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, isRecurring: true, nextResetAt: "2026-09-28T19:00:00.000Z" }) });
    renderWithTheme(<RecurrencePrompt eventId="e1" isRecurring={false} complete />);

    expect(screen.getByTestId("recurrence-prompt")).toBeInTheDocument();
    expect(screen.getByTestId("recurrence-weekly")).toBeInTheDocument();
  });

  it("POSTs a weekly rule for the game's weekday and confirms on success", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true, isRecurring: true }) });
    renderWithTheme(<RecurrencePrompt eventId="e1" isRecurring={false} complete />);

    fireEvent.click(screen.getByTestId("recurrence-weekly"));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/events/e1/recurrence");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body.isRecurring).toBe(true);
    expect(body.recurrenceFreq).toBe("weekly");
    expect(body.recurrenceInterval).toBe(1);

    await waitFor(() => expect(screen.getByTestId("recurrence-done")).toBeInTheDocument());
  });

  it("shows the recurring state instead of the prompt when already recurring", () => {
    renderWithTheme(<RecurrencePrompt eventId="e1" isRecurring complete />);
    expect(screen.queryByTestId("recurrence-weekly")).not.toBeInTheDocument();
    expect(screen.getByTestId("recurrence-already")).toBeInTheDocument();
  });

  it("surfaces an API failure without pretending it worked", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({ error: "Nope" }) });
    renderWithTheme(<RecurrencePrompt eventId="e1" isRecurring={false} complete />);

    fireEvent.click(screen.getByTestId("recurrence-weekly"));
    await waitFor(() => expect(screen.getByTestId("recurrence-error")).toBeInTheDocument());
    expect(screen.queryByTestId("recurrence-done")).not.toBeInTheDocument();
  });
});
