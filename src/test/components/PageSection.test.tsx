import { afterEach, describe, expect, it } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { renderWithTheme } from "../render";
import { PageSection, SECTION_SPACING } from "~/components/event/story/PageSection";

afterEach(cleanup);

describe("PageSection", () => {
  it("is a named region and keeps one rhythm: 24px page gap, +8px for a major section, 32px for a nested one", () => {
    renderWithTheme(<PageSection gap="major" aria-label="Next game">x</PageSection>);
    expect(screen.getByRole("region", { name: "Next game" })).toHaveAttribute("data-gap", "major");
    // The theme spacing unit is 8px: 24 (page gap) + 8 = 32 for a major section; a nested one is 32 on its own.
    expect(SECTION_SPACING).toEqual({ page: 0, major: 1, nested: 4 });
  });
});
