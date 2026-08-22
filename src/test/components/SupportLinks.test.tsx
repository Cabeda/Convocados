// eslint-disable @typescript-eslint/ban-ts-comment
// @ts-nocheck
import { describe, it, expect, vi, afterEach } from "vitest";
import { screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import SupportLinks from "~/components/SupportLinks";

vi.mock("~/lib/useT", () => ({
  useT: () => (key: string) => key,
}));

describe("SupportLinks", () => {
  afterEach(() => cleanup());

  it("renders a GitHub Sponsors link to the project account", () => {
    renderWithTheme(<SupportLinks />);
    const link = screen.getByRole("link", { name: /github sponsors/i });
    expect(link).toHaveAttribute("href", "https://github.com/sponsors/Cabeda");
  });

  it("renders a Ko-fi link to the project page", () => {
    renderWithTheme(<SupportLinks />);
    const link = screen.getByRole("link", { name: /ko-fi/i });
    expect(link).toHaveAttribute("href", "https://ko-fi.com/cabeda");
  });

  it("opens external links in a new tab with noopener", () => {
    renderWithTheme(<SupportLinks />);
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });
});
