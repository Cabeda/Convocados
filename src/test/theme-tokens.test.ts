import { describe, it, expect } from "vitest";
import { tokens } from "../theme/tokens";
import { buildThemeOptions } from "../theme";

describe("design tokens", () => {
  it("should export light and dark palette with all required keys", () => {
    expect(tokens.palette.light.primary.main).toBe("#1b6b4a");
    expect(tokens.palette.light.primary.light).toBe("#4e9d7a");
    expect(tokens.palette.light.primary.dark).toBe("#004d2e");
    expect(tokens.palette.light.primary.contrastText).toBe("#ffffff");
    expect(tokens.palette.dark.primary.main).toBe("#7edcab");
    expect(tokens.palette.dark.primary.light).toBe("#a8ecc8");
    expect(tokens.palette.dark.primary.dark).toBe("#4faa80");
    expect(tokens.palette.dark.primary.contrastText).toBe("#003822");
  });

  it("should export typography tokens", () => {
    expect(tokens.typography.fontFamily).toContain("Inter");
    expect(tokens.typography.h4.fontWeight).toBe(700);
    expect(tokens.typography.button.textTransform).toBe("none");
  });

  it("should export shape tokens", () => {
    expect(tokens.shape.borderRadius).toBe(12);
  });
});

describe("buildThemeOptions", () => {
  it("should produce light theme options matching current theme", () => {
    const theme = buildThemeOptions("light");
    expect(theme.palette?.mode).toBe("light");
    expect((theme.palette?.primary as Record<string, string>)?.main).toBe("#1b6b4a");
    expect((theme.palette?.background as Record<string, string>)?.default).toBe("#f8faf6");
  });

  it("should produce dark theme options matching current theme", () => {
    const theme = buildThemeOptions("dark");
    expect(theme.palette?.mode).toBe("dark");
    expect((theme.palette?.primary as Record<string, string>)?.main).toBe("#7edcab");
    expect((theme.palette?.background as Record<string, string>)?.default).toBe("#111412");
  });

  it("should include component overrides for buttons", () => {
    const theme = buildThemeOptions("light");
    const buttonOverrides = (theme.components?.MuiButton?.styleOverrides || {}) as Record<string, unknown>;
    expect((buttonOverrides.root as Record<string, unknown>)?.borderRadius).toBe(20);
  });

  it("should include component overrides for chips", () => {
    const theme = buildThemeOptions("light");
    const chipOverrides = (theme.components?.MuiChip?.styleOverrides || {}) as Record<string, unknown>;
    expect((chipOverrides.root as Record<string, unknown>)?.borderRadius).toBe(8);
  });
});
