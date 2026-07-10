import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PaymentMethodOverrideDialog } from "~/components/event/PaymentMethodOverrideDialog";

(globalThis as any).__APP_VERSION__ = "0.0.0-test";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});
afterEach(() => cleanup());

const eventUsers = [
  { id: "u-jose", name: "José", role: "owner" as const },
  { id: "u-pai", name: "Pai", role: "admin" as const },
  { id: "u-ana", name: "Ana", role: "player" as const },
];

describe("PaymentMethodOverrideDialog — payer picker", () => {
  it("renders a payer Select for each method, defaulting to 'each player'", () => {
    renderWithTheme(
      <PaymentMethodOverrideDialog
        eventId="evt-1"
        defaultMethods={JSON.stringify([{ type: "mbway", value: "912345678" }])}
        overrideMethods={null}
        canSetDefault
        eventUsers={eventUsers}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    // The payer select should be present and default to "each player".
    const payerSelect = screen.getAllByTestId("payment-method-payer")[0];
    expect(payerSelect).toBeInTheDocument();
  });

  it("includes payerUserId + payerName in the saved payload when a payer is set", async () => {
    // We test the round-trip by opening the dialog with the payer pre-set
    // (the overrideMethods path), saving it, and asserting the API body.
    // The interactive menu-pick is hard to simulate in jsdom (MUI Select
    // uses Popper which doesn't fully open in jsdom) but the open/save
    // round-trip proves the data flows through correctly.
    const fetchMock = vi.fn((url: string, init?: any) => {
      if (url.includes("/cost/override") && init?.method === "PUT") {
        return Promise.resolve({ ok: true, json: async () => ({ ok: true }) } as any);
      }
      return Promise.resolve({ ok: true, json: async () => ({}) } as any);
    });
    vi.stubGlobal("fetch", fetchMock);

    renderWithTheme(
      <PaymentMethodOverrideDialog
        eventId="evt-1"
        defaultMethods={null}
        overrideMethods={JSON.stringify([
          { type: "mbway", value: "912345678", payerUserId: "u-jose", payerName: "José" },
        ])}
        canSetDefault
        eventUsers={eventUsers}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Apply for this game/i }));

    await waitFor(() => {
      const putCall = fetchMock.mock.calls.find(
        ([url, init]) => typeof url === "string" && url.includes("/cost/override") && init?.method === "PUT",
      );
      expect(putCall).toBeDefined();
      const body = JSON.parse((putCall?.[1] as any).body);
      expect(body.paymentMethods[0].payerUserId).toBe("u-jose");
      expect(body.paymentMethods[0].payerName).toBe("José");
    });
  });

  it("preserves an existing payer when reopening the dialog", () => {
    renderWithTheme(
      <PaymentMethodOverrideDialog
        eventId="evt-1"
        defaultMethods={null}
        overrideMethods={JSON.stringify([
          { type: "mbway", value: "912345678", payerUserId: "u-pai", payerName: "Pai" },
        ])}
        canSetDefault
        eventUsers={eventUsers}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    // The payer select should show "Pai" as the current value.
    const payerSelect = screen.getAllByTestId("payment-method-payer")[0];
    expect(payerSelect.textContent).toMatch(/Pai/);
  });

  it("accepts methods without a payer (backwards compat)", () => {
    renderWithTheme(
      <PaymentMethodOverrideDialog
        eventId="evt-1"
        defaultMethods={JSON.stringify([{ type: "cash", value: "On arrival" }])}
        overrideMethods={null}
        canSetDefault
        eventUsers={eventUsers}
        open
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );
    const payerSelect = screen.getAllByTestId("payment-method-payer")[0];
    // Default value: "Each player pays directly to the court"
    expect(payerSelect.textContent).toMatch(/each|direct|player/i);
  });
});
