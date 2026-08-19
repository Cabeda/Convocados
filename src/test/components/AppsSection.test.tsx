import { describe, it, expect, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import AppsSection from "~/components/AppsSection";

afterEach(() => cleanup());

const BETA_URL = "https://play.google.com/apps/testing/com.cabeda.Convocados";
const KO_FI_GOAL_URL = "https://ko-fi.com/cabeda/goal?g=20";
const GITHUB_SPONSORS_URL = "https://github.com/sponsors/Cabeda";
const DOCS_URL = "/docs/mobile";

describe("AppsSection", () => {
  it("renders the iOS fundraising card heading", () => {
    renderWithTheme(<AppsSection />);
    expect(
      screen.getByRole("heading", { name: /Help bring Convocados to iPhone/i }),
    ).toBeInTheDocument();
  });

  it("shows the exact progress text for the raised total", () => {
    renderWithTheme(<AppsSection />);
    expect(screen.getByText("$0 of $100 raised")).toBeInTheDocument();
  });

  it("links the primary CTA to the Ko-fi goal in a new tab with safe attrs", () => {
    renderWithTheme(<AppsSection />);
    const link = screen.getByRole("link", { name: /Help fund the iOS app/i });
    expect(link).toHaveAttribute("href", KO_FI_GOAL_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(link).toHaveAttribute("rel", expect.stringContaining("noreferrer"));
  });

  it("links GitHub Sponsors for monthly support", () => {
    renderWithTheme(<AppsSection />);
    const link = screen.getByRole("link", { name: /Prefer monthly support\? GitHub Sponsors/i });
    expect(link).toHaveAttribute("href", GITHUB_SPONSORS_URL);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("keeps the Android beta CTA present", () => {
    renderWithTheme(<AppsSection />);
    const link = screen.getByRole("link", { name: /Get the Android beta app/i });
    expect(link).toHaveAttribute("href", BETA_URL);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("links to the mobile apps docs for more info", () => {
    renderWithTheme(<AppsSection />);
    const link = screen.getByRole("link", { name: /Learn more about the mobile apps/i });
    expect(link).toHaveAttribute("href", DOCS_URL);
  });
});
