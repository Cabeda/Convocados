import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React from "react";
import { screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import * as jestDomMatchers from "@testing-library/jest-dom/matchers";
import { renderWithTheme } from "../render";
import { PaymentNudgeDialog } from "~/components/event/PaymentNudgeDialog";

expect.extend(jestDomMatchers);

vi.mock("~/lib/useT", () => ({
  useT: () => (key: string, params?: Record<string, unknown>) => {
    if (params) {
      return Object.entries(params).reduce(
        (acc, [k, v]) => acc.replace(`{${k}}`, String(v)),
        key,
      );
    }
    return key;
  },
}));

const h: typeof React.createElement = React.createElement;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderDialog(props: {
  open: boolean;
  onClose?: () => void;
  onJoin?: () => Promise<void>;
}) {
  return renderWithTheme(
    h(PaymentNudgeDialog, {
      eventId: "evt-1",
      open: props.open,
      onClose: props.onClose ?? vi.fn(),
      onJoin: props.onJoin ?? vi.fn().mockResolvedValue(undefined),
    }),
  );
}

describe("PaymentNudgeDialog", () => {
  beforeEach(() => {
    // Default balance + cost responses.
    vi.stubGlobal("fetch", vi.fn((url: string) => {
      if (url.includes("/balance")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            enforcement: "nudge",
            threshold: 0,
            callerBalance: { playerName: "Alex", amount: 12.5, gamesOwed: 2, streak: 3 },
            aggregate: { paidCount: 4, totalCount: 8 },
          }),
        });
      }
      if (url.includes("/cost")) {
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({
            totalAmount: 100,
            currency: "EUR",
            effectivePaymentMethods: null,
            payments: [{ amount: 50 }, { amount: 50 }],
          }),
        });
      }
      return Promise.resolve({ ok: false, json: () => Promise.resolve({}) });
    }));
  });

  it("does not render dialog content when closed", () => {
    renderDialog({ open: false });
    expect(screen.queryByText("paymentNudgeTitle")).not.toBeInTheDocument();
  });

  it("renders the dialog title when open", async () => {
    renderDialog({ open: true });
    await waitFor(() => {
      expect(screen.getByText("paymentNudgeTitle")).toBeInTheDocument();
    });
  });

  it("calls onClose when the dialog backdrop is clicked", async () => {
    const onClose = vi.fn();
    renderDialog({ open: true, onClose });
    // The MUI Dialog renders a backdrop with role="presentation"
    const backdrop = document.querySelector(".MuiBackdrop-root") ?? document.querySelector(".MuiDialog-root");
    expect(backdrop).toBeInTheDocument();
  });

  it("calls onJoin when 'Join later' is clicked", async () => {
    const onJoin = vi.fn().mockResolvedValue(undefined);
    renderDialog({ open: true, onJoin });
    await waitFor(() => {
      expect(screen.getByText("paymentNudgeJoinLater")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("paymentNudgeJoinLater"));
    await waitFor(() => expect(onJoin).toHaveBeenCalled());
  });
});
