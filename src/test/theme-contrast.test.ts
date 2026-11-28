import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { createTheme } from "@mui/material/styles";
import { buildThemeOptions } from "../theme";

/** WCAG relative luminance of an `rgb()`/`rgba()`/`#rrggbb` colour over an opaque backdrop. */
function toRgb(color: string, backdrop?: [number, number, number]): [number, number, number] {
  if (color.startsWith("#")) {
    const n = parseInt(color.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const [r, g, b, a = 1] = color.match(/[\d.]+/g)!.map(Number);
  if (!backdrop) return [r, g, b];
  return [r, g, b].map((c, i) => Math.round(c * a + backdrop[i] * (1 - a))) as [number, number, number];
}
const lum = ([r, g, b]: [number, number, number]) => {
  const f = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (fg: string, bg: string) => {
  const back = toRgb(bg);
  const [a, b] = [lum(toRgb(fg, back)), lum(back)];
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

describe("text colours the event header leans on, in both themes", () => {
  for (const mode of ["light", "dark"] as const) {
    const theme = createTheme(buildThemeOptions(mode));
    const surfaces = [theme.palette.background.default, theme.palette.background.paper];

    it(`${mode}: text.secondary reads at 4.5:1 on the page and on a card`, () => {
      for (const bg of surfaces) expect(ratio(theme.palette.text.secondary, bg)).toBeGreaterThanOrEqual(4.5);
    });

    it(`${mode}: primary, as text on the page (Following), reads at 4.5:1`, () => {
      for (const bg of surfaces) expect(ratio(theme.palette.primary.main, bg)).toBeGreaterThanOrEqual(4.5);
    });

  }

  it("light: text.disabled does not, which is why the header never uses it for words", () => {
    const theme = createTheme(buildThemeOptions("light"));
    expect(ratio(theme.palette.text.disabled, theme.palette.background.default)).toBeLessThan(4.5);
  });
});

describe("header and story components", () => {
  it("never colour words with text.disabled", () => {
    const dir = resolve(__dirname, "../components/event");
    const files = [
      resolve(dir, "EventHeader.tsx"),
      ...readdirSync(resolve(dir, "story")).filter((f) => f.endsWith(".tsx")).map((f) => resolve(dir, "story", f)),
    ];
    const offenders = files.filter((f) => /\bcolor: "text\.disabled"/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });
});
