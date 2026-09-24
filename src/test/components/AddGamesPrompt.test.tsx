/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup, fireEvent } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { AddGamesPrompt } from "~/components/AddGamesPrompt";

const DISMISS_KEY = "add_games_prompt_dismissed_at";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("AddGamesPrompt", () => {
  it("renders the copy and CTA when not dismissed", () => {
    renderWithTheme(<AddGamesPrompt onAdd={vi.fn()} />);
    expect(screen.getByText(/Add your other games/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Add a game/i })).toBeInTheDocument();
  });

  it("calls onAdd when the CTA is clicked", () => {
    const onAdd = vi.fn();
    renderWithTheme(<AddGamesPrompt onAdd={onAdd} />);
    fireEvent.click(screen.getByRole("button", { name: /Add a game/i }));
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it("hides and records dismissal on Dismiss", () => {
    renderWithTheme(<AddGamesPrompt onAdd={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Dismiss/i }));
    expect(screen.queryByText(/Add your other games/i)).not.toBeInTheDocument();
    expect(localStorage.getItem(DISMISS_KEY)).toBeTruthy();
  });

  it("stays hidden while within the cooldown", () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now()));
    renderWithTheme(<AddGamesPrompt onAdd={vi.fn()} />);
    expect(screen.queryByText(/Add your other games/i)).not.toBeInTheDocument();
  });

  it("shows again once the cooldown has elapsed", () => {
    localStorage.setItem(DISMISS_KEY, String(Date.now() - 31 * 24 * 60 * 60 * 1000));
    renderWithTheme(<AddGamesPrompt onAdd={vi.fn()} />);
    expect(screen.getByText(/Add your other games/i)).toBeInTheDocument();
  });
});
