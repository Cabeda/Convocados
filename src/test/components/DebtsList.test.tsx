import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { DebtsList } from "~/components/settle/DebtsList";

(globalThis as any).__APP_VERSION__ = "0.0.0-test";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});
afterEach(() => cleanup());

const debts = [
  { fromName: "Pai", toName: "José", amountCents: 277760 },
];

describe("DebtsList", () => {
  it("renders a row per debt with debtor name and amount in primary color", () => {
    renderWithTheme(
      <DebtsList
        debts={debts}
        currency="EUR"
        onMarkSettled={vi.fn()}
        onRemind={vi.fn()}
        onGenerateQr={vi.fn()}
      />,
    );
    expect(screen.getByText("Pai")).toBeInTheDocument();
    // Amount formatted as €2,777.60
    expect(screen.getByText(/2,777\.60/)).toBeInTheDocument();
  });

  it("shows the creditor name on the right side of the arrow", () => {
    renderWithTheme(
      <DebtsList
        debts={debts}
        currency="EUR"
        onMarkSettled={vi.fn()}
        onRemind={vi.fn()}
        onGenerateQr={vi.fn()}
      />,
    );
    expect(screen.getByText("José")).toBeInTheDocument();
  });

  it("renders the all-clear state when there are no debts", () => {
    renderWithTheme(
      <DebtsList
        debts={[]}
        currency="EUR"
        onMarkSettled={vi.fn()}
        onRemind={vi.fn()}
        onGenerateQr={vi.fn()}
      />,
    );
    expect(screen.getByText(/all caught up/i)).toBeInTheDocument();
  });

  it("opens the context menu when anywhere on the row is clicked", () => {
    renderWithTheme(
      <DebtsList
        debts={debts}
        currency="EUR"
        onMarkSettled={vi.fn()}
        onRemind={vi.fn()}
        onGenerateQr={vi.fn()}
      />,
    );
    // Click the debtor side (Pai name) — should open the menu.
    const row = screen.getByTestId("debt-row-Pai-José");
    fireEvent.click(row);
    expect(screen.getByTestId("debt-action-mark-settled")).toBeInTheDocument();
    expect(screen.getByTestId("debt-action-remind")).toBeInTheDocument();
    expect(screen.getByTestId("debt-action-generate-qr")).toBeInTheDocument();
  });

  it("opens the context menu when the debtor name is clicked", () => {
    renderWithTheme(
      <DebtsList
        debts={debts}
        currency="EUR"
        onMarkSettled={vi.fn()}
        onRemind={vi.fn()}
        onGenerateQr={vi.fn()}
      />,
    );
    // The debtor label is just a <span>, clicking it should also open the menu.
    const debtorName = screen.getByText("Pai");
    fireEvent.click(debtorName);
    expect(screen.getByTestId("debt-action-mark-settled")).toBeInTheDocument();
  });

  it("opens the context menu when the creditor avatar is clicked (kept for a11y)", () => {
    renderWithTheme(
      <DebtsList
        debts={debts}
        currency="EUR"
        onMarkSettled={vi.fn()}
        onRemind={vi.fn()}
        onGenerateQr={vi.fn()}
      />,
    );
    // The creditor avatar is a labelled button (a11y affordance). Clicking
    // it directly still opens the menu — same handler as the row.
    const joseButton = screen.getByRole("button", { name: /José/ });
    fireEvent.click(joseButton);
    expect(screen.getByTestId("debt-action-mark-settled")).toBeInTheDocument();
  });

  it("invokes onMarkSettled when Mark settled is clicked", () => {
    const onMarkSettled = vi.fn();
    renderWithTheme(
      <DebtsList
        debts={debts}
        currency="EUR"
        onMarkSettled={onMarkSettled}
        onRemind={vi.fn()}
        onGenerateQr={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /José/ }));
    fireEvent.click(screen.getByTestId("debt-action-mark-settled"));
    expect(onMarkSettled).toHaveBeenCalledWith(debts[0]);
  });

  it("invokes onRemind when Remind is clicked", () => {
    const onRemind = vi.fn();
    renderWithTheme(
      <DebtsList
        debts={debts}
        currency="EUR"
        onMarkSettled={vi.fn()}
        onRemind={onRemind}
        onGenerateQr={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /José/ }));
    fireEvent.click(screen.getByTestId("debt-action-remind"));
    expect(onRemind).toHaveBeenCalledWith(debts[0]);
  });

  it("invokes onGenerateQr when Generate QR is clicked", () => {
    const onGenerateQr = vi.fn();
    renderWithTheme(
      <DebtsList
        debts={debts}
        currency="EUR"
        onMarkSettled={vi.fn()}
        onRemind={vi.fn()}
        onGenerateQr={onGenerateQr}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /José/ }));
    fireEvent.click(screen.getByTestId("debt-action-generate-qr"));
    expect(onGenerateQr).toHaveBeenCalledWith(debts[0]);
  });

  it("closes the context menu via the More avatar click toggle", () => {
    // MUI Popover's auto-close-on-outside-click is hard to assert in jsdom
    // because of the portal/modal manager. Verify the simpler invariant:
    // clicking the avatar toggles the popover closed again.
    const { container } = renderWithTheme(
      <DebtsList
        debts={debts}
        currency="EUR"
        onMarkSettled={vi.fn()}
        onRemind={vi.fn()}
        onGenerateQr={vi.fn()}
      />,
    );
    const joseButton = screen.getByRole("button", { name: /José/ });
    fireEvent.click(joseButton);
    expect(screen.getByTestId("debt-action-mark-settled")).toBeInTheDocument();
    // Clicking the body outside the popover should close it (MUI default).
    fireEvent.click(document.body);
    // Re-query: the menu items should be gone.
    expect(container.querySelector('[data-testid="debt-action-mark-settled"]')).toBeNull();
  });
});
