import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PayerCard } from "~/components/PayerCard";

const apiRequest = vi.fn();
vi.mock("~/lib/api/client", () => ({
  apiRequest: (...args: unknown[]) => apiRequest(...args),
}));

const state = {
  gameId: "g1",
  mode: "tracked",
  hasCost: true,
  payerName: "Ana",
  isPayer: false,
  isRosterPlayer: true,
  canClaim: true,
  payerDetailsUrl: null,
  vacant: false,
};

beforeEach(() => {
  apiRequest.mockReset();
  apiRequest.mockImplementation((operation: string) =>
    Promise.resolve(operation.startsWith("GET ") ? state : {}),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("PayerCard takeover", () => {
  it("confirms before displacing the current payer", async () => {
    renderWithTheme(<PayerCard eventId="e1" />);

    const trigger = await screen.findByRole("button", { name: "Take over from Ana" });
    fireEvent.click(trigger);

    expect(await screen.findByText("Ana is collecting. Take over?")).toBeInTheDocument();
    expect(apiRequest).not.toHaveBeenCalledWith(
      "POST /api/events/{id}/payments/payer/claim",
      expect.anything(),
    );

    fireEvent.click(screen.getByRole("button", { name: "Take over" }));

    await waitFor(() =>
      expect(apiRequest).toHaveBeenCalledWith(
        "POST /api/events/{id}/payments/payer/claim",
        expect.objectContaining({ params: { id: "e1" } }),
      ),
    );
  });
});
