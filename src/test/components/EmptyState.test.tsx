import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { EmptyState } from "~/components/EmptyState";
import AddIcon from "@mui/icons-material/Add";
import SportsIcon from "@mui/icons-material/Sports";

describe("EmptyState", () => {
  it("renders with title and icon", () => {
    const { unmount } = render(<EmptyState icon={SportsIcon} title="No games yet" />);
    expect(screen.getByText("No games yet")).toBeInTheDocument();
    expect(screen.getByTestId("SportsIcon")).toBeInTheDocument();
    unmount();
  });

  it("renders with description", () => {
    const { unmount } = render(
      <EmptyState
        icon={SportsIcon}
        title="No games description test"
        description="Create your first game to get started"
      />
    );
    expect(screen.getByText("Create your first game to get started")).toBeInTheDocument();
    unmount();
  });

  it("renders with primary action button", () => {
    const handleClick = vi.fn();
    const { unmount } = render(
      <EmptyState
        icon={AddIcon}
        title="No players"
        action={{ label: "Add player", onClick: handleClick }}
      />
    );
    expect(screen.getByText("Add player")).toBeInTheDocument();
    unmount();
  });

  it("calls action onClick when button is clicked", () => {
    const handleClick = vi.fn();
    const { unmount } = render(
      <EmptyState
        icon={AddIcon}
        title="No players click test"
        action={{ label: "Add player test", onClick: handleClick }}
      />
    );
    const button = screen.getByRole("button", { name: /Add player test/i });
    fireEvent.click(button);
    expect(handleClick).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("renders with secondary action button", () => {
    const handlePrimary = vi.fn();
    const handleSecondary = vi.fn();
    const { unmount } = render(
      <EmptyState
        icon={SportsIcon}
        title="No games secondary"
        description="Create a game to get started"
        action={{ label: "Create game", onClick: handlePrimary }}
        secondaryAction={{ label: "Browse public games", onClick: handleSecondary }}
      />
    );
    expect(screen.getByText("Create game")).toBeInTheDocument();
    expect(screen.getByText("Browse public games")).toBeInTheDocument();
    unmount();
  });

  it("renders without action buttons when not provided", () => {
    const { unmount, container } = render(<EmptyState icon={SportsIcon} title="No data unique" />);
    // Check title is rendered within this specific container
    expect(container.querySelector('h6')?.textContent).toBe("No data unique");
    // Check there are no buttons in this specific render
    expect(container.querySelectorAll('button')).toHaveLength(0);
    unmount();
  });
});