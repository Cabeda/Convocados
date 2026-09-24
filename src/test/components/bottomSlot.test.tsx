import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup, render } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import {
  BottomSlotProvider,
  useBottomSlotClaim,
  type BottomBannerId,
} from "~/lib/bottomSlot";

afterEach(() => {
  cleanup();
});

function Probe({ id, wants }: { id: BottomBannerId; wants: boolean }) {
  const granted = useBottomSlotClaim(id, wants);
  if (!granted) return null;
  return <div data-testid={id}>{id}</div>;
}

describe("BottomSlotProvider arbitration", () => {
  it("grants only the highest-priority claimant (update beats install)", async () => {
    render(
      <BottomSlotProvider>
        <Probe id="update" wants />
        <Probe id="install" wants />
      </BottomSlotProvider>,
    );

    expect(await screen.findByTestId("update")).toBeInTheDocument();
    expect(screen.queryByTestId("install")).not.toBeInTheDocument();
  });

  it("hands the slot to install once update stops claiming", async () => {
    const { rerender } = render(
      <BottomSlotProvider>
        <Probe id="update" wants />
        <Probe id="install" wants />
      </BottomSlotProvider>,
    );

    expect(await screen.findByTestId("update")).toBeInTheDocument();

    rerender(
      <BottomSlotProvider>
        <Probe id="update" wants={false} />
        <Probe id="install" wants />
      </BottomSlotProvider>,
    );

    expect(await screen.findByTestId("install")).toBeInTheDocument();
    expect(screen.queryByTestId("update")).not.toBeInTheDocument();
  });

  it("suppresses push while the install banner owns the slot", async () => {
    render(
      <BottomSlotProvider>
        <Probe id="install" wants />
        <Probe id="push" wants />
      </BottomSlotProvider>,
    );

    expect(await screen.findByTestId("install")).toBeInTheDocument();
    expect(screen.queryByTestId("push")).not.toBeInTheDocument();
  });

  it("grants every claimant when rendered with no provider (standalone use)", async () => {
    render(<Probe id="push" wants />);

    expect(await screen.findByTestId("push")).toBeInTheDocument();
  });
});
