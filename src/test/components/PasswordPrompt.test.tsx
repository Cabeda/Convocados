import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";

vi.mock("~/lib/useT", () => ({
  useT: () => (key: string) => key,
}));

import { PasswordPrompt } from "~/components/event/PasswordPrompt";

const mockFetch = vi.fn();

beforeEach(() => {
  mockFetch.mockReset();
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PasswordPrompt", () => {
  it("checks the password through the API client", async () => {
    mockFetch.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), {
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );
    const onUnlocked = vi.fn();

    render(<PasswordPrompt eventId="e 1" title="Cup" onUnlocked={onUnlocked} />);
    await userEvent.type(screen.getByLabelText("enterPassword"), "hunter2");
    await userEvent.click(screen.getByRole("button", { name: "unlockEvent" }));

    await waitFor(() => expect(onUnlocked).toHaveBeenCalled());
    expect(mockFetch).toHaveBeenCalledWith("/api/events/e%201/access/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: "hunter2" }),
    });
  });
});
