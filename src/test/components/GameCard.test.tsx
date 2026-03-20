import { describe, it, expect, beforeEach, afterEach } from "vitest";
import React from "react";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { GameCard, type GameSummary } from "~/components/GameCard";

// Mock __APP_VERSION__
(globalThis as any).__APP_VERSION__ = "0.0.0-test";

afterEach(() => cleanup());

const baseGame: GameSummary = {
  id: "test-123",
  title: "Tuesday 5-a-side",
  location: "Riverside Astro",
  dateTime: new Date(2026, 5, 15, 20, 0).toISOString(),
  sport: "football-5v5",
  maxPlayers: 10,
  playerCount: 7,
};

describe("GameCard", () => {
  it("renders game title as a link", () => {
    renderWithTheme(<GameCard game={baseGame} />);
    const link = screen.getByRole("link", { name: /Tuesday 5-a-side/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute("href", "/events/test-123");
  });

  it("renders player count chip", () => {
    renderWithTheme(<GameCard game={baseGame} />);
    expect(screen.getByText("7/10")).toBeInTheDocument();
  });

  it("renders location when provided", () => {
    renderWithTheme(<GameCard game={baseGame} />);
    expect(screen.getByText("Riverside Astro")).toBeInTheDocument();
  });

  it("does not render location when empty", () => {
    renderWithTheme(<GameCard game={{ ...baseGame, location: "" }} />);
    expect(screen.queryByText("Riverside Astro")).not.toBeInTheDocument();
  });

  it("renders date/time", () => {
    renderWithTheme(<GameCard game={baseGame} />);
    const dateEl = screen.getByText(/Jun|15/);
    expect(dateEl).toBeInTheDocument();
  });

  it("renders normally for future games with dimPast", () => {
    const { container } = renderWithTheme(<GameCard game={baseGame} dimPast />);
    const paper = container.querySelector(".MuiPaper-root");
    expect(paper).toBeTruthy();
  });

  it("renders past games with dimPast=false normally", () => {
    const pastGame = { ...baseGame, dateTime: new Date(2020, 0, 1).toISOString() };
    renderWithTheme(<GameCard game={pastGame} dimPast={false} />);
    expect(screen.getByText("Tuesday 5-a-side")).toBeInTheDocument();
  });

  it("shows warning color chip when game is full", () => {
    const fullGame = { ...baseGame, playerCount: 10 };
    renderWithTheme(<GameCard game={fullGame} />);
    expect(screen.getByText("10/10")).toBeInTheDocument();
  });
});
