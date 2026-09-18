/**
 * README screenshot profile.
 *
 * Regenerates the committed images under `docs/screenshots/web/` from a
 * deterministic fixture. Run via `npm run screenshots:readme` against a
 * seeded throwaway database. CI owns these files — see
 * docs/adr/0037-ci-owned-readme-screenshots.md.
 */

import path from "path";
import type { Page } from "@playwright/test";
import type { Shot } from "./capture";
import { DESKTOP_DEVICE, assertUniqueShotNames, captureProfile } from "./capture";

export const README_OUT_DIR = path.resolve("docs/screenshots/web");

const HERO_EVENT = "screenshot-hero";
const DEMO_USER = "demo-organizer-001";

/** Scroll the landing page down to the inline create-game form. */
async function scrollToCreateForm(page: Page): Promise<void> {
  const titleField = page.locator('input[name="title"]').first();
  await titleField.waitFor({ state: "visible", timeout: 10_000 });
  await titleField.scrollIntoViewIfNeeded();
}

export const README_SHOTS: Shot[] = [
  { name: "01-landing", path: "/" },
  { name: "01-create-game", path: "/", fullPage: false, setup: scrollToCreateForm },
  {
    name: "02-create-game-advanced",
    path: "/",
    fullPage: false,
    setup: async (page) => {
      await scrollToCreateForm(page);
      await page.getByText("Advanced options", { exact: true }).first().click();
    },
  },
  { name: "03-dashboard", path: "/dashboard" },
  { name: "04-event-detail", path: `/events/${HERO_EVENT}` },
  { name: "05-event-history", path: `/events/${HERO_EVENT}/history` },
  { name: "06-event-rankings", path: `/events/${HERO_EVENT}/rankings` },
  { name: "07-event-settings", path: `/events/${HERO_EVENT}/settings` },
  { name: "08-event-attendance", path: `/events/${HERO_EVENT}/attendance` },
  { name: "09-event-log", path: `/events/${HERO_EVENT}/log` },
  { name: "10-user-profile", path: `/users/${DEMO_USER}` },
  { name: "11-public-games", path: "/public" },
  {
    name: "12-user-menu",
    path: "/dashboard",
    fullPage: false,
    setup: async (page) => {
      await page.locator("header button:has(.MuiAvatar-root)").first().click();
    },
  },
];

async function main() {
  assertUniqueShotNames(README_SHOTS);
  console.log(`\n=== README screenshot capture (${README_SHOTS.length} shots) ===`);
  console.log(`  Output: ${README_OUT_DIR}`);
  await captureProfile({ shots: README_SHOTS, outDir: README_OUT_DIR, device: DESKTOP_DEVICE });
  console.log(`\nDone — ${README_SHOTS.length} screenshots written to ${README_OUT_DIR}`);
}

// Only auto-run when invoked directly, so tests can import the shot list.
if (process.argv[1] && process.argv[1].endsWith("readme.ts")) {
  main().catch((err) => {
    console.error("\n✗ Fatal:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
