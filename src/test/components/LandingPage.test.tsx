// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import LandingPage from "~/components/LandingPage";

// Mock __APP_VERSION__ (used by the layout footer)
(globalThis as any).__APP_VERSION__ = "0.0.0-test";

const BETA_URL = "https://play.google.com/apps/testing/com.cabeda.Convocados";

afterEach(() => cleanup());

describe("LandingPage beta CTA", () => {
  it("renders at least one link to the Android beta", () => {
    renderWithTheme(<LandingPage />);
    const links = screen.getAllByRole("link", { name: /Get the Android beta app/i });
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) {
      expect(link).toHaveAttribute("href", BETA_URL);
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  it("renders the beta banner with a heading and body", () => {
    renderWithTheme(<LandingPage />);
    expect(screen.getByRole("heading", { name: /Test the Android app early/i })).toBeInTheDocument();
    expect(screen.getByText(/Join the beta and install Convocados/i)).toBeInTheDocument();
  });
});
