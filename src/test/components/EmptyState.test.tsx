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

    const button = screen.getByRole("button", { name: "Add player" });
    expect(button).toBeInTheDocument();
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

    const button = screen.getByRole("button", { name: "Add player" });
    button.click();

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

    expect(screen.getByRole("button", { name: "Create game" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Browse public games" })).toBeInTheDocument();
  });

  it("renders without action buttons when not provided", () => {
    render(<EmptyState icon={SportsIcon} title="No data" />);

    // Check that we can find the title
    expect(screen.getByText("No data")).toBeInTheDocument();
    // Check that we don't have buttons with specific action labels
    expect(screen.queryByRole("button", { name: "Create game" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Browse public games" })).not.toBeInTheDocument();
  });
});