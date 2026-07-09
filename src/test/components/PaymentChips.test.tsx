import { describe, it, expect, vi, afterEach } from "vitest";
import React from "react";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PaymentChips, type PaymentChipEntry } from "~/components/PaymentChips";

(globalThis as any).__APP_VERSION__ = "0.0.0-test";

afterEach(() => cleanup());

const payments: PaymentChipEntry[] = [
  { playerName: "Kevin", amount: 25, status: "pending", method: null },
  { playerName: "Alice", amount: 25, status: "paid", method: "cash" },
];

describe("PaymentChips", () => {
  it("renders a chip per payment with amount", () => {
    renderWithTheme(<PaymentChips payments={payments} />);
    expect(screen.getByText(/Kevin/)).toBeInTheDocument();
    expect(screen.getByText(/Alice/)).toBeInTheDocument();
  });

  it("does not fire onToggle when not editable", () => {
    const onToggle = vi.fn();
    renderWithTheme(<PaymentChips payments={payments} onToggle={onToggle} />);
    fireEvent.click(screen.getByText(/Kevin/));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("fires onToggle with the correct index when editable", () => {
    const onToggle = vi.fn();
    renderWithTheme(<PaymentChips payments={payments} editable onToggle={onToggle} />);
    fireEvent.click(screen.getByText(/Kevin/));
    expect(onToggle).toHaveBeenCalledWith(0);
  });

  it("does not fire onToggle for a disabled (paid) chip", () => {
    const onToggle = vi.fn();
    renderWithTheme(
      <PaymentChips payments={payments} editable onToggle={onToggle} isDisabled={(p) => p.status === "paid"} />,
    );
    fireEvent.click(screen.getByText(/Alice/));
    expect(onToggle).not.toHaveBeenCalled();
  });

  it("shows method references when showMethodRefs is set", () => {
    renderWithTheme(<PaymentChips payments={payments} showMethodRefs />);
    expect(screen.getByText(/Alice: cash/)).toBeInTheDocument();
  });
});
