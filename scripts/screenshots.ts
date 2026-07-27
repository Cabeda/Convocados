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
 */

import { chromium } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";
import path from "path";
import fs from "fs";

const BASE_URL = process.env.UI_REVIEW_URL ?? "http://localhost:4321";
const OUTPUT_ROOT = path.resolve(process.env.UI_REVIEW_DIR ?? "./screenshots");
const VIEWPORT = { width: 1440, height: 900 };
const DEMO_EMAIL = "demo@convocados.app";
const DEMO_PASSWORD = "demo123";
const DEMO_USER_ID = "demo-organizer-001";

interface Route {
  path: string;
  name: string;
  requiresAuth: boolean;
}

/** Resolve routes, optionally with event IDs discovered from the API. */
async function resolveRoutes(): Promise<Route[]> {
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

  let eventIds: string[] = [];
  try {
    const res = await fetch(`${BASE_URL}/api/events/public`);
    if (res.ok) {
      const body = await res.json() as { data?: { id: string }[] };
      if (body.data) {
        eventIds = body.data.map((e) => e.id);
      }
    }
  } catch {
    // API unreachable — skip event-specific routes
  }

  if (eventIds.length === 0) {
    try {
      const res = await fetch(`${BASE_URL}/api/health`);
      if (res.ok) {
        console.warn("  ⚠  Public events API returned no data — event pages will be skipped");
      } else {
        console.warn(`  ⚠  Server at ${BASE_URL} is not healthy — pages may fail`);
      }
    } catch {
      console.warn(`  ⚠  Cannot reach server at ${BASE_URL} — is it running?`);
    }
    return staticRoutes;
  }

  const firstEventId = eventIds[0];
  const eventRoutes: Route[] = [
    { path: `/events/${firstEventId}`, name: "event-detail", requiresAuth: false },
    { path: `/events/${firstEventId}/settings`, name: "event-settings", requiresAuth: true },
    { path: `/events/${firstEventId}/history`, name: "event-history", requiresAuth: true },
    { path: `/events/${firstEventId}/rankings`, name: "event-rankings", requiresAuth: true },
    { path: `/events/${firstEventId}/settle`, name: "event-settle", requiresAuth: true },
    { path: `/events/${firstEventId}/attendance`, name: "event-attendance", requiresAuth: true },
  ];

  return [...staticRoutes, ...eventRoutes];
}

async function signIn(page: Page): Promise<boolean> {
  try {
    // Sign-in page is a React island (client:only) — wait for hydration
    await page.goto(`${BASE_URL}/auth/signin`, { waitUntil: "networkidle", timeout: 20_000 });
    await page.waitForTimeout(2000);

    // Default tab is Magic Link (email-only). Switch to Password tab.
    const passwordTab = page.locator('button[role="tab"]:has-text("Password")');
    if (await passwordTab.isVisible({ timeout: 5_000 })) {
      await passwordTab.click();
      await page.waitForTimeout(500);
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
    await page.waitForURL(/\/dashboard|\//, { timeout: 15_000 });
    return true;
  } catch (err) {
    console.warn(`  ⚠  Sign-in failed: ${err instanceof Error ? err.message : err}`);
    return false;
  }
}

async function takeScreenshots() {
  console.log(`\n=== UI Review Screenshot Pipeline ===`);
  console.log(`  Target:  ${BASE_URL}`);
  console.log(`  Output:  ${OUTPUT_ROOT}`);
  console.log(`  Viewport: ${VIEWPORT.width}x${VIEWPORT.height}\n`);

  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

  const routes = await resolveRoutes();
  console.log(`  Routes: ${routes.length} (${routes.filter((r) => r.requiresAuth).length} require auth)\n`);

  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  let signedIn = false;

  for (const route of routes) {
    if (route.requiresAuth && !signedIn) {
      console.log(`→ Signing in as ${DEMO_EMAIL}...`);
      signedIn = await signIn(page);
      if (signedIn) {
        console.log(`  ✓ Signed in\n`);
      } else {
        console.warn(`  → Continuing without auth — signed pages will show login\n`);
        // Reset page state after failed sign-in
        try {
          await page.goto(`${BASE_URL}/`, { timeout: 10_000 });
        } catch {
          // ignore
        }
      }
    }

    const url = `${BASE_URL}${route.path}`;
    const filename = `${route.name}.png`;
    const filepath = path.join(OUTPUT_ROOT, filename);

    process.stdout.write(`  ${route.path}`);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: filepath, fullPage: false });
      process.stdout.write(` → ${filename}\n`);
    } catch (err) {
      process.stdout.write(` ⚠ ${err instanceof Error ? err.message : "error"}\n`);
    }
  }

  await browser.close();

  const files = fs.readdirSync(OUTPUT_ROOT).filter((f) => f.endsWith(".png"));
  console.log(`\n✓ Done — ${files.length} screenshots in ${OUTPUT_ROOT}/`);
  for (const f of files.sort()) {
    const stat = fs.statSync(path.join(OUTPUT_ROOT, f));
    console.log(`  ${f} (${(stat.size / 1024).toFixed(0)} KB)`);
  }
}

takeScreenshots().catch((err) => {
  console.error("\n✗ Fatal:", err instanceof Error ? err.message : err);
  process.exit(1);
});
