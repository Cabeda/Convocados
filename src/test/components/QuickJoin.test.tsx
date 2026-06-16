import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { QuickJoin } from "~/components/event/QuickJoin";
import type { Player } from "~/components/event/types";

afterEach(() => cleanup());

const players: Player[] = [
  { id: "p1", name: "Alice", userId: "u1" },
];

const baseProps = {
  eventId: "evt-1",
  userName: "Charlie",
  players,
  maxPlayers: 10,
  onJoin: vi.fn().mockResolvedValue(undefined),
  onLeave: vi.fn().mockResolvedValue(undefined),
  autoOpenPay: false,
  paymentEnforcement: "off" as const,
  callerBalance: null,
  isJoined: false,
  hasOutstandingBalance: false,
  autoPayOnJoin: false,
  onSetAutoPayOnJoin: vi.fn(),
};

describe("QuickJoin — does not show confirmation dialog (self-initiated)", () => {
  it("calls onJoin directly when the Join button is clicked (no dialog)", async () => {
    const user = userEvent.setup();
    renderWithTheme(<QuickJoin {...baseProps} />);
    const joinButton = screen.getByRole("button", { name: /join/i });
    await user.click(joinButton);
    expect(baseProps.onJoin).toHaveBeenCalled();
    // No dialog should be open. MUI Dialog has role="dialog".
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
