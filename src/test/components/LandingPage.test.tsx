/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- component test type suppression for @testing-library/react screen exports
import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import LandingPage from "~/components/LandingPage";

// Mock __APP_VERSION__ (used by the layout footer)
(globalThis as any).__APP_VERSION__ = "0.0.0-test";

const STORE_URL = "https://play.google.com/store/apps/details?id=com.cabeda.Convocados";

afterEach(() => cleanup());

describe("LandingPage Play Store CTA", () => {
  it("renders at least one link to the Android app on Google Play", () => {
    renderWithTheme(<LandingPage />);
    const links = screen.getAllByRole("link", { name: /Get the Android app/i });
    expect(links.length).toBeGreaterThanOrEqual(1);
    for (const link of links) {
      expect(link).toHaveAttribute("href", STORE_URL);
      expect(link).toHaveAttribute("target", "_blank");
    }
  });

  it("renders the apps banner with a heading and body", () => {
    renderWithTheme(<LandingPage />);
    expect(screen.getByRole("heading", { name: /Convocados on Google Play/i })).toBeInTheDocument();
    expect(screen.getByText(/Install Convocados straight from the Play Store/i)).toBeInTheDocument();
  });
});
