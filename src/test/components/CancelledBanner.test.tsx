/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { CancelledBanner } from "~/components/event/story/CancelledBanner";

afterEach(cleanup);

describe("CancelledBanner", () => {
  it("gives the organiser a real button to plan a new game, which goes to the start page", () => {
    renderWithTheme(<CancelledBanner canManage />);
    expect(screen.getByRole("link", { name: "Plan a new game" })).toHaveAttribute("href", "/");
    expect(screen.getByText("This game was cancelled")).toBeInTheDocument();
  });

  it("shows a player only the news, with nothing to press", () => {
    renderWithTheme(<CancelledBanner canManage={false} />);
    expect(screen.getByText("This game was cancelled")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
