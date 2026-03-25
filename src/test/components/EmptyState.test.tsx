import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
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

    // Find by text since MUI may render multiple elements with button role
    expect(screen.getByText("Add player")).toBeInTheDocument();
  });

  it("calls action onClick when button is clicked", () => {
    const handleClick = vi.fn();
    render(
      <EmptyState
        icon={AddIcon}
        title="No players"
        action={{ label: "Add player", onClick: handleClick }}
      />
    );

    // Use fireEvent.click on the button element
    const button = screen.getByRole("button", { name: /Add player/i });
    fireEvent.click(button);

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

    expect(screen.getByText("Create game")).toBeInTheDocument();
    expect(screen.getByText("Browse public games")).toBeInTheDocument();
  });

  it("renders without action buttons when not provided", () => {
    render(<EmptyState icon={SportsIcon} title="No data" />);

    expect(screen.getByText("No data")).toBeInTheDocument();
    // The Paper component from MUI wraps everything but shouldn't have action buttons
    // Just verify the title is there and no button text is present
    expect(screen.queryByText("Create game")).not.toBeInTheDocument();
    expect(screen.queryByText("Add player")).not.toBeInTheDocument();
    expect(screen.queryByText("Browse public games")).not.toBeInTheDocument();
  });
});