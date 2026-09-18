/**
 * Shared Playwright capture engine.
 *
 * Used by two callers with different output contracts:
 *   - scripts/screenshots.ts   → gitignored `screenshots/` (AI UI review)
 *   - scripts/screenshots/readme.ts → committed `docs/screenshots/web/` (README)
 *
 * Capture is deterministic: a fixed browser clock, pinned locale/timezone/
 * viewport, reduced motion, seeded `Math.random`, and neutralized PWA/service
 * worker surfaces. See docs/adr/0037-ci-owned-readme-screenshots.md.
 */

import { chromium } from "@playwright/test";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import fs from "fs";
import path from "path";

export const DEFAULT_BASE_URL = process.env.UI_REVIEW_URL ?? "http://localhost:4321";
export const FIXED_TIME = process.env.CONVOCADOS_FIXED_NOW ?? "2026-03-14T18:00:00.000Z";

export const DEMO_EMAIL = "demo@convocados.app";
export const DEMO_PASSWORD = "demo123";

export const README_VIEWPORT = { width: 1512, height: 810 };

export interface DeviceProfile {
  name: string;
  viewport: { width: number; height: number };
  context: { isMobile?: boolean; hasTouch?: boolean; userAgent?: string; deviceScaleFactor?: number };
}

export const DESKTOP_DEVICE: DeviceProfile = {
  name: "desktop",
  viewport: README_VIEWPORT,
  context: { deviceScaleFactor: 2 },
};

export const MOBILE_DEVICE: DeviceProfile = {
  name: "mobile",
  viewport: { width: 390, height: 844 },
  context: {
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
};

export interface Shot {
  /** Output file basename, without extension. Unique within a profile. */
  name: string;
  /** Route path relative to the base URL. */
  path: string;
  /** Full-page capture (default true). Set false for a framed viewport shot. */
  fullPage?: boolean;
  /** Optional interaction to run after navigation and before capture. */
  setup?: (page: Page) => Promise<void>;
}

/** Deterministic bootstrap injected before any page script runs. */
export async function deterministicInit(page: Page): Promise<void> {
  await page.addInitScript(`
    (() => {
      try {
        localStorage.setItem("convocados-locale", "en");
        localStorage.setItem("themeMode", "light");
        localStorage.setItem("pwa-install-dismissed", "1742000000000");
      } catch (e) { /* ignore */ }

      // Replace Math.random with a seeded PRNG so any UI randomness is stable.
      // Divisor is 2^31 so the result is always in [0, 1) — never 1.0, which
      // would index past the end of arrays.
      let seed = 0x2f6e2b1;
      Math.random = function () {
        seed = (seed * 1103515245 + 12345) & 0x7fffffff;
        return seed / 0x80000000;
      };

      // Stub the service worker so the update banner never appears.
      try {
        Object.defineProperty(navigator, "serviceWorker", {
          configurable: true,
          value: {
            register: () => new Promise(() => {}),
            getRegistration: async () => null,
            getRegistrations: async () => [],
            controller: null,
            addEventListener: () => {},
            removeEventListener: () => {},
          },
        });
      } catch (e) { /* ignore */ }
    })();
  `);
}

const ANIMATION_KILL_CSS = `
  *, *::before, *::after {
    transition: none !important;
    animation: none !important;
    caret-color: transparent !important;
  }
`;

export async function newDeterministicContext(
  browser: Browser,
  device: DeviceProfile,
): Promise<BrowserContext> {
  return browser.newContext({
    viewport: device.viewport,
    deviceScaleFactor: device.context.deviceScaleFactor ?? 1,
    isMobile: device.context.isMobile,
    hasTouch: device.context.hasTouch,
    userAgent: device.context.userAgent,
    locale: "en-US",
    timezoneId: "Europe/Lisbon",
    colorScheme: "light",
    reducedMotion: "reduce",
  });
}

/** Install a fixed clock and deterministic bootstrap on a page. */
export async function preparePage(page: Page): Promise<void> {
  await deterministicInit(page);
  try {
    await page.clock.install({ time: new Date(FIXED_TIME) });
  } catch {
    try {
      await page.clock.setFixedTime(new Date(FIXED_TIME));
    } catch {
      /* no clock control available; best effort */
    }
  }
}

export async function signIn(page: Page, baseUrl = DEFAULT_BASE_URL): Promise<boolean> {
  try {
    await page.goto(`${baseUrl}/auth/signin`, { waitUntil: "networkidle", timeout: 20_000 });
    await page.waitForTimeout(1500);

    const passwordTab = page.locator('button[role="tab"]:has-text("Password")');
    if (await passwordTab.isVisible({ timeout: 5_000 })) {
      await passwordTab.click();
      await page.waitForTimeout(300);
    }

    const emailInput = page.locator('input[type="email"]').first();
    const passwordInput = page.locator('input[type="password"]').first();
    const submitButton = page.locator('button[type="submit"]').first();

    if (!(await emailInput.isVisible({ timeout: 5_000 }))) {
      console.warn("  ⚠  Sign-in form not visible");
      return false;
    }

    await emailInput.fill(DEMO_EMAIL);
    await passwordInput.fill(DEMO_PASSWORD);
    await submitButton.click();

    for (let i = 0; i < 15; i++) {
      const session = await page
        .evaluate(async () => {
          const res = await fetch("/api/auth/get-session");
          return res.ok ? res.json() : null;
        })
        .catch(() => null);
      if (session) {
        await page.waitForTimeout(300);
        return true;
      }
      await page.waitForTimeout(1000);
    }
    return false;
  } catch (err) {
    console.warn(`  ⚠  Sign-in failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

/** Capture one shot into `outDir` (created if missing). Throws on failure. */
export async function captureShot(
  page: Page,
  baseUrl: string,
  shot: Shot,
  outDir: string,
): Promise<void> {
  fs.mkdirSync(outDir, { recursive: true });
  const filepath = path.join(outDir, `${shot.name}.png`);

  await page.goto(`${baseUrl}${shot.path}`, { waitUntil: "networkidle", timeout: 20_000 });
  await page.addStyleTag({ content: ANIMATION_KILL_CSS });
  await page.waitForTimeout(600);

  if (shot.setup) {
    await shot.setup(page);
    await page.addStyleTag({ content: ANIMATION_KILL_CSS });
    await page.waitForTimeout(400);
  }

  await page.screenshot({
    path: filepath,
    fullPage: shot.fullPage ?? true,
    animations: "disabled",
    caret: "hide",
  });
  process.stdout.write(`  ✓ ${shot.name}.png\n`);
}

/**
 * Capture every shot into a temporary directory, then move the PNGs into
 * `outDir`. Nothing is published unless every shot succeeds — a partial run
 * leaves the committed screenshots untouched.
 */
export async function captureProfile(opts: {
  shots: Shot[];
  outDir: string;
  device: DeviceProfile;
  baseUrl?: string;
  signedIn?: boolean;
}): Promise<string> {
  const { shots, outDir, device } = opts;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const signedIn = opts.signedIn ?? true;

  const tempDir = `${outDir}.tmp-${process.pid}`;
  fs.rmSync(tempDir, { recursive: true, force: true });
  fs.mkdirSync(tempDir, { recursive: true });

  const browser: Browser = await chromium.launch({ headless: true });
  try {
    const context = await newDeterministicContext(browser, device);
    const page = await context.newPage();
    await preparePage(page);

    if (signedIn) {
      console.log(`Signing in as ${DEMO_EMAIL}...`);
      const ok = await signIn(page, baseUrl);
      if (!ok) throw new Error("Sign-in failed — aborting capture");
      console.log("  ✓ Signed in");
    }

    for (const shot of shots) {
      await captureShot(page, baseUrl, shot, tempDir);
    }

    await context.close();
    publishShots(tempDir, outDir);
    return outDir;
  } finally {
    await browser.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/** Move all PNGs from `tempDir` into `outDir`, replacing existing files. */
export function publishShots(tempDir: string, outDir: string): void {
  fs.mkdirSync(outDir, { recursive: true });
  for (const file of fs.readdirSync(tempDir)) {
    if (!file.endsWith(".png")) continue;
    fs.renameSync(path.join(tempDir, file), path.join(outDir, file));
  }
}

/** Assert shot names are unique (a pure guard reused by tests). */
export function assertUniqueShotNames(shots: Shot[]): void {
  const seen = new Set<string>();
  for (const shot of shots) {
    if (seen.has(shot.name)) {
      throw new Error(`Duplicate screenshot name: ${shot.name}`);
    }
    seen.add(shot.name);
  }
}
