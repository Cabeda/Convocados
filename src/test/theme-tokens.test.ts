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

describe("attention role (the \"needs you\" dot, both themes)", () => {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const contrast = (a: string, b: string) => {
    const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    if (max === min) return 0;
    const d = max - min;
    const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return (h * 60 + 360) % 360;
  };

  it.each(["light", "dark"] as const)("is amber, not brown, in the %s theme", (mode) => {
    const { fill } = tokens.palette[mode].attention;
    expect(hue(fill)).toBeGreaterThanOrEqual(35);
    expect(hue(fill)).toBeLessThanOrEqual(48);
    expect(lum(fill)).toBeGreaterThan(0.3); // a bright fill: brown #7d5700 is ~0.11
  });

  it.each(["light", "dark"] as const)("is visible against the card surface in the %s theme (3:1, non-text)", (mode) => {
    const { fill, ring } = tokens.palette[mode].attention;
    const surface = tokens.palette[mode].background.paper;
    // The indicator is the fill when it carries the contrast itself, otherwise its ring does.
    expect(Math.max(contrast(fill, surface), contrast(ring, surface))).toBeGreaterThanOrEqual(3);
  });

  it("reaches the MUI palette in both modes", () => {
    for (const mode of ["light", "dark"] as const) {
      const palette = buildThemeOptions(mode).palette as unknown as { attention: { main: string; ring: string } };
      expect(palette.attention.main).toBe(tokens.palette[mode].attention.fill);
      expect(palette.attention.ring).toBe(tokens.palette[mode].attention.ring);
    }
  });
});
