import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { TransactionsList, type Transaction } from "~/components/settle/TransactionsList";

(globalThis as any).__APP_VERSION__ = "0.0.0-test";

beforeEach(() => {
  window.history.replaceState({}, "", "/");
});
afterEach(() => cleanup());

const sample: Transaction[] = [
  {
    id: "live-1",
    date: "2026-07-10T20:00:00Z",
    type: "game",
    description: "Pai — game payment",
    amountCents: 600,
    currency: "EUR",
    status: "pending",
    playerName: "Pai",
  },
  {
    id: "sub-1",
    date: "2026-07-01T00:00:00Z",
    type: "subscription",
    description: "José — monthly subscription",
    amountCents: 3000,
    currency: "EUR",
    status: "active",
    playerName: "José",
  },
  {
    id: "spend-1",
    date: "2026-06-15T10:00:00Z",
    type: "spend",
    description: "Bought balls",
    amountCents: 1500,
    currency: "EUR",
    status: "paid",
  },
];

describe("TransactionsList", () => {
  it("renders one row per transaction with the formatted amount", () => {
    renderWithTheme(
      <TransactionsList
        transactions={sample}
        onAddTransaction={vi.fn()}
        onEditTransaction={vi.fn()}
        onDeleteTransaction={vi.fn()}
      />,
    );
    expect(screen.getByText(/Pai/)).toBeInTheDocument();
    expect(screen.getByText(/José/)).toBeInTheDocument();
    expect(screen.getByText(/Bought balls/)).toBeInTheDocument();
    expect(screen.getByText("€6.00")).toBeInTheDocument();
    expect(screen.getByText("€30.00")).toBeInTheDocument();
    expect(screen.getByText("€15.00")).toBeInTheDocument();
  });

  it("shows a type icon for each row (game / subscription / spend)", () => {
    const { container } = renderWithTheme(
      <TransactionsList
        transactions={sample}
        onAddTransaction={vi.fn()}
                onEditTransaction={vi.fn()}
                onDeleteTransaction={vi.fn()}
      />,
    );
    // Each row has a leading icon — verify the test-ids are present.
    expect(container.querySelectorAll('[data-testid^="txn-icon-"]')).toHaveLength(3);
    expect(container.querySelector('[data-testid="txn-icon-game"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="txn-icon-subscription"]')).toBeTruthy();
    expect(container.querySelector('[data-testid="txn-icon-spend"]')).toBeTruthy();
  });

  it("renders the 'Add transaction' button", () => {
    renderWithTheme(
      <TransactionsList
        transactions={sample}
        onAddTransaction={vi.fn()}
                onEditTransaction={vi.fn()}
                onDeleteTransaction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("add-transaction-button")).toBeInTheDocument();
  });

  it("calls onAddTransaction when the Add button is clicked", () => {
    const onAddTransaction = vi.fn();
    renderWithTheme(
      <TransactionsList
        transactions={sample}
        onAddTransaction={onAddTransaction}
        onEditTransaction={vi.fn()}
        onDeleteTransaction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId("add-transaction-button"));
    expect(onAddTransaction).toHaveBeenCalledTimes(1);
  });

  it("filters to the selected type (game / subscription / spend / all)", () => {
    const { rerender } = renderWithTheme(
      <TransactionsList
        transactions={sample}
        onAddTransaction={vi.fn()}
                onEditTransaction={vi.fn()}
                onDeleteTransaction={vi.fn()}
      />,
    );
    // Default: all visible
    expect(screen.getAllByTestId("txn-row").length).toBe(3);

    // Click "Games" filter
    fireEvent.click(screen.getByTestId("txn-filter-game"));
    expect(screen.getAllByTestId("txn-row").length).toBe(1);
    expect(screen.getByText(/Pai/)).toBeInTheDocument();
    expect(screen.queryByText(/José/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bought balls/)).not.toBeInTheDocument();

    // Click "Subscriptions" filter
    fireEvent.click(screen.getByTestId("txn-filter-subscription"));
    expect(screen.getAllByTestId("txn-row").length).toBe(1);
    expect(screen.getByText(/José/)).toBeInTheDocument();
    expect(screen.queryByText(/Pai/)).not.toBeInTheDocument();

    // Click "Spends" filter
    fireEvent.click(screen.getByTestId("txn-filter-spend"));
    expect(screen.getAllByTestId("txn-row").length).toBe(1);
    expect(screen.getByText(/Bought balls/)).toBeInTheDocument();

    // Click "All" filter
    fireEvent.click(screen.getByTestId("txn-filter-all"));
    expect(screen.getAllByTestId("txn-row").length).toBe(3);

    // Sanity: the rerender didn't break anything
    rerender(
      <TransactionsList
        transactions={sample}
        onAddTransaction={vi.fn()}
        onEditTransaction={vi.fn()}
        onDeleteTransaction={vi.fn()}
      />,
    );
    expect(screen.getAllByTestId("txn-row").length).toBe(3);
  });

  it("renders the empty state when there are no transactions", () => {
    renderWithTheme(
      <TransactionsList
        transactions={[]}
        onAddTransaction={vi.fn()}
        onEditTransaction={vi.fn()}
        onDeleteTransaction={vi.fn()}
      />,
    );
    expect(screen.getByTestId("transactions-empty")).toBeInTheDocument();
  });

  it("opens the row menu with Edit and Delete options when the more icon is clicked", () => {
    renderWithTheme(
      <TransactionsList
        transactions={sample}
        onAddTransaction={vi.fn()}
        onEditTransaction={vi.fn()}
        onDeleteTransaction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId(`txn-row-actions-${sample[0].id}`));
    expect(screen.getByTestId("txn-row-edit")).toBeInTheDocument();
    expect(screen.getByTestId("txn-row-delete")).toBeInTheDocument();
  });

  it("calls onEditTransaction with the row when Edit is clicked", () => {
    const onEditTransaction = vi.fn();
    renderWithTheme(
      <TransactionsList
        transactions={sample}
        onAddTransaction={vi.fn()}
        onEditTransaction={onEditTransaction}
        onDeleteTransaction={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByTestId(`txn-row-actions-${sample[1].id}`));
    fireEvent.click(screen.getByTestId("txn-row-edit"));
    expect(onEditTransaction).toHaveBeenCalledWith(sample[1]);
  });

  it("shows a delete confirmation dialog and calls onDeleteTransaction on confirm", () => {
    const onDeleteTransaction = vi.fn();
    renderWithTheme(
      <TransactionsList
        transactions={sample}
        onAddTransaction={vi.fn()}
        onEditTransaction={vi.fn()}
        onDeleteTransaction={onDeleteTransaction}
      />,
    );
    fireEvent.click(screen.getByTestId(`txn-row-actions-${sample[2].id}`));
    fireEvent.click(screen.getByTestId("txn-row-delete"));
    // Confirmation dialog appears
    expect(screen.getByText(/Delete this transaction/i)).toBeInTheDocument();
    // Confirm
    fireEvent.click(screen.getByTestId("txn-delete-confirm"));
    expect(onDeleteTransaction).toHaveBeenCalledWith(sample[2]);
  });
});
