/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach, vi } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { AddPlayerConfirmDialog } from "~/components/event/AddPlayerConfirmDialog";

afterEach(() => cleanup());

const baseProps = {
  eventName: "Ninjas",
  isBench: false,
  isAdding: false,
  isInviting: false,
  onClose: vi.fn(),
};

describe("AddPlayerConfirmDialog — share-link action", () => {
  it("offers share-a-link for a linked user and dispatches via='link'", () => {
    const onConfirm = vi.fn();
    renderWithTheme(
      <AddPlayerConfirmDialog
        {...baseProps}
        intent={{ kind: "single", name: "Luís Lopes", userId: "u-luis", source: "chip" }}
        onConfirm={onConfirm}
      />,
    );
    const btn = screen.getByTestId("add-player-confirm-share");
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    expect(onConfirm).toHaveBeenCalledWith(
      { kind: "single", name: "Luís Lopes", userId: "u-luis", source: "chip" },
      true,
      "link",
    );
  });

  it("keeps the notifying invite dispatching via='notify'", () => {
    const onConfirm = vi.fn();
    renderWithTheme(
      <AddPlayerConfirmDialog
        {...baseProps}
        intent={{ kind: "single", name: "Joana", userId: "u-joana", source: "dropdown" }}
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByTestId("add-player-confirm-invite"));
    expect(onConfirm).toHaveBeenCalledWith(
      { kind: "single", name: "Joana", userId: "u-joana", source: "dropdown" },
      true,
      "notify",
    );
  });
});
