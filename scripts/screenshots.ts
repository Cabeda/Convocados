#!/usr/bin/env tsx
/**
 * scripts/screenshots.ts
 *
 * Generates screenshots of all web app pages for use as AI-review input
 * to the MUI design pipeline.
 *
 * Usage:
 *   tsx scripts/screenshots.ts
 *   UI_REVIEW_URL=http://localhost:4321 tsx scripts/screenshots.ts
 *   UI_REVIEW_DIR=./screenshots tsx scripts/screenshots.ts
 *
 * Prerequisites:
 *   - Dev server running on the target URL (default: http://localhost:4321)
 *   - Seed data populated (npm run db:seed seeds demo@convocados.app / demo123)
 *
 * For the committed README screenshots use scripts/screenshots/readme.ts
 * (`npm run screenshots:readme`) instead — it writes docs/screenshots/web/.
 */

import { chromium } from "@playwright/test";
import type { Browser } from "@playwright/test";
import path from "path";
import fs from "fs";
import {
  DEMO_EMAIL,
  newDeterministicContext,
  preparePage,
  signIn,
  type DeviceProfile,
} from "./screenshots/capture";

const BASE_URL = process.env.UI_REVIEW_URL ?? "http://localhost:4321";
const OUTPUT_ROOT = path.resolve(process.env.UI_REVIEW_DIR ?? "./screenshots");
const DEMO_USER_ID = "demo-organizer-001";

const DEVICES: DeviceProfile[] = [
  {
    name: "desktop",
    viewport: { width: 1440, height: 900 },
    context: {},
  },
  {
    name: "mobile",
    viewport: { width: 390, height: 844 },
    context: {
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    },
  },
];

interface Route {
  path: string;
  name: string;
  requiresAuth: boolean;
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Find an event ID that has at least one game history entry. */
async function findEventWithHistory(eventIds: string[]): Promise<string | null> {
  for (const id of eventIds) {
    const data = await fetchJson<{ data?: unknown[] }>(`${BASE_URL}/api/events/${id}/history?limit=1`);
    if (data && data.data && data.data.length > 0) {
      return id;
    }
  }
  return null;
}

/** Resolve routes, picking an event with game history for dynamic routes. */
async function resolveRoutes(signedIn: boolean): Promise<Route[]> {
  const staticRoutes: Route[] = [
    { path: "/", name: "landing", requiresAuth: false },
    { path: "/auth/signin", name: "auth-signin", requiresAuth: false },
    { path: "/auth/signup", name: "auth-signup", requiresAuth: false },
    { path: "/public", name: "public-games", requiresAuth: false },
    { path: "/docs", name: "docs-index", requiresAuth: false },
    { path: "/docs/quickstart", name: "docs-quickstart", requiresAuth: false },
    { path: "/dashboard", name: "dashboard", requiresAuth: true },
    { path: "/admin", name: "admin", requiresAuth: true },
    { path: "/court-watches", name: "court-watches", requiresAuth: true },
    { path: `/users/${DEMO_USER_ID}`, name: "user-profile", requiresAuth: true },
  ];

  const publicData = await fetchJson<{ data?: { id: string }[] }>(`${BASE_URL}/api/events/public`);
  const publicEventIds = publicData?.data?.map((e) => e.id) ?? [];

  if (publicEventIds.length === 0) {
    try {
      const health = await fetchJson<{ status: string }>(`${BASE_URL}/api/health`);
      if (health) {
        console.warn("  ⚠  Public events API returned no data — event pages will be skipped");
      } else {
        console.warn(`  ⚠  Server at ${BASE_URL} is not healthy — pages may fail`);
      }
    } catch {
      console.warn(`  ⚠  Cannot reach server at ${BASE_URL} — is it running?`);
    }
    return staticRoutes;
  }

  let ownedEventIds: string[] = [];
  if (signedIn) {
    const meData = await fetchJson<{ owned?: { id: string }[] }>(`${BASE_URL}/api/me/games`);
    if (meData?.owned) {
      ownedEventIds = meData.owned.map((e) => e.id);
    }
  }

  const allCandidateIds = [...new Set([...ownedEventIds, ...publicEventIds])];
  const eventId = (await findEventWithHistory(allCandidateIds)) ?? publicEventIds[0];

  const eventRoutes: Route[] = [
    { path: `/events/${eventId}`, name: "event-detail", requiresAuth: false },
    { path: `/events/${eventId}/settings`, name: "event-settings", requiresAuth: true },
    { path: `/events/${eventId}/history`, name: "event-history", requiresAuth: true },
    { path: `/events/${eventId}/rankings`, name: "event-rankings", requiresAuth: true },
    { path: `/events/${eventId}/settle`, name: "event-settle", requiresAuth: true },
    { path: `/events/${eventId}/attendance`, name: "event-attendance", requiresAuth: true },
  ];

  return [...staticRoutes, ...eventRoutes];
}

/** Capture one full set of screenshots into outputDir, signed in or not. */
async function captureSet(
  browser: Browser,
  opts: { outputDir: string; signedIn: boolean; label: string; device: DeviceProfile },
) {
  const { outputDir, signedIn, label, device } = opts;
  fs.mkdirSync(outputDir, { recursive: true });

  const context = await newDeterministicContext(browser, device);
  const page = await context.newPage();
  await preparePage(page);

  let authed = signedIn;
  if (signedIn) {
    console.log(`\n→ ${label}: signing in as ${DEMO_EMAIL}...`);
    authed = await signIn(page, BASE_URL);
    if (authed) {
      console.log(`  ✓ Signed in`);
    } else {
      console.warn(`  ⚠  Sign-in failed — event pages may use public events without history`);
    }
  }

  const routes = await resolveRoutes(authed);

  if (authed) {
    try {
      await page.goto(`${BASE_URL}/`, { timeout: 10_000 });
    } catch {
      /* ignore */
    }
  }

  console.log(`  Routes: ${routes.length} (${routes.filter((r) => r.requiresAuth).length} require auth)`);

  for (const route of routes) {
    const url = `${BASE_URL}${route.path}`;
    const filename = `${route.name}.png`;
    const filepath = path.join(outputDir, filename);

    process.stdout.write(`  ${route.path}`);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
      await page.waitForTimeout(1000);

      const signedInOnPage = await page.evaluate(async () => {
        try {
          const res = await fetch("/api/auth/get-session");
          const s = await res.json();
          return Boolean(s && s.user);
        } catch {
          return false;
        }
      });

      await page.screenshot({ path: filepath, fullPage: true, animations: "disabled", caret: "hide" });
      process.stdout.write(` → ${filename} [${signedInOnPage ? "signed-in" : "signed-out"}]\n`);
    } catch (err) {
      process.stdout.write(` ⚠ ${err instanceof Error ? err.message : "error"}\n`);
    }
  }

  await context.close();

  const files = fs.readdirSync(outputDir).filter((f) => f.endsWith(".png"));
  console.log(`  ✓ ${files.length} screenshots in ${outputDir}`);
}

async function takeScreenshots() {
  console.log(`\n=== UI Review Screenshot Pipeline ===`);
  console.log(`  Target:  ${BASE_URL}`);
  console.log(`  Output:  ${OUTPUT_ROOT}`);
  console.log(
    `  Devices: ${DEVICES.map((d) => `${d.name} (${d.viewport.width}x${d.viewport.height})`).join(", ")}\n`,
  );

  const browser: Browser = await chromium.launch({ headless: true });

  for (const device of DEVICES) {
    const deviceRoot = path.join(OUTPUT_ROOT, device.name);

    await captureSet(browser, {
      outputDir: path.join(deviceRoot, "anonymous"),
      signedIn: false,
      label: `${device.name} anonymous`,
      device,
    });

    await captureSet(browser, {
      outputDir: path.join(deviceRoot, "auth"),
      signedIn: true,
      label: `${device.name} authenticated`,
      device,
    });
  }

  await browser.close();
}

takeScreenshots().catch((err) => {
  console.error("\n✗ Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
