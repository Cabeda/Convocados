import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EmptyState } from "~/components/EmptyState";
import AddIcon from "@mui/icons-material/Add";
import SportsIcon from "@mui/icons-material/Sports";

describe("EmptyState", () => {
  it("renders with title and icon", () => {
    render(<EmptyState icon={SportsIcon} title="No games yet" />);

    expect(screen.getByText("No games yet")).toBeInTheDocument();
    expect(screen.getByTestId("SportsIcon")).toBeInTheDocument();
  });

  it("renders with description", () => {
    render(
      <EmptyState
        icon={SportsIcon}
        title="No games yet"
        description="Create your first game to get started"
      />
    );

    expect(screen.getByText("Create your first game to get started")).toBeInTheDocument();
  });

  it("renders with primary action button", () => {
    const handleClick = vi.fn();
    render(
      <EmptyState
        icon={AddIcon}
        title="No players"
        action={{ label: "Add player", onClick: handleClick }}
      />
    );

    const buttons = screen.getAllByRole("button", { name: "Add player" });
    expect(buttons.length).toBeGreaterThan(0);
  });

  it("calls action onClick when button is clicked", async () => {
    const handleClick = vi.fn();
    render(
      <EmptyState
        icon={AddIcon}
        title="No players"
        action={{ label: "Add player", onClick: handleClick }}
      />
    );

    const buttons = screen.getAllByRole("button", { name: "Add player" });
    buttons[0].click();

    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it("renders with secondary action button", () => {
    const handlePrimary = vi.fn();
    const handleSecondary = vi.fn();
    render(
      <EmptyState
        icon={SportsIcon}
        title="No games"
        description="Create a game to get started"
        action={{ label: "Create game", onClick: handlePrimary }}
        secondaryAction={{ label: "Browse public games", onClick: handleSecondary }}
      />
    );

    const primaryButtons = screen.getAllByRole("button", { name: "Create game" });
    const secondaryButtons = screen.getAllByRole("button", { name: "Browse public games" });
    
    expect(primaryButtons.length).toBeGreaterThan(0);
    expect(secondaryButtons.length).toBeGreaterThan(0);
  });

it("renders without action buttons when not provided", () => {
    render(<EmptyState icon={SportsIcon} title="No data" />);

    expect(screen.getByText("No data")).toBeInTheDocument();
    // Check the title exists and there are no action labels present
    expect(screen.queryAllByRole("button", { name: "Create game" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Add player" })).toHaveLength(0);
    expect(screen.queryAllByRole("button", { name: "Browse public games" })).toHaveLength(0);
  });
});