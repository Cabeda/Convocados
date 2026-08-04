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

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return await res.json() as T;
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

  // Collect public event IDs
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

  // Also collect events the demo user owns (signed-in only)
  let ownedEventIds: string[] = [];
  if (signedIn) {
    const meData = await fetchJson<{ owned?: { id: string }[] }>(`${BASE_URL}/api/me/games`);
    if (meData?.owned) {
      ownedEventIds = meData.owned.map((e) => e.id);
    }
  }

  // Find an event with game history — prefer owned, fall back to public
  const allCandidateIds = [...new Set([...ownedEventIds, ...publicEventIds])];
  const eventId = await findEventWithHistory(allCandidateIds) ?? publicEventIds[0];

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

  // Try signing in before resolving routes so we can discover owned events
  const browser: Browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT });
  const page = await context.newPage();

  console.log(`→ Signing in as ${DEMO_EMAIL} to discover event routes...`);
  const signedIn = await signIn(page);
  if (signedIn) {
    console.log(`  ✓ Signed in\n`);
  } else {
    console.warn(`  ⚠  Sign-in failed — event pages may use public events without history\n`);
  }

  // Resolve routes now that we know auth state
  const routes = await resolveRoutes(signedIn);

  // Back to a neutral page after sign-in
  if (signedIn) {
    try { await page.goto(`${BASE_URL}/`, { timeout: 10_000 }); } catch { /* ignore */ }
  }

  console.log(`  Routes: ${routes.length} (${routes.filter((r) => r.requiresAuth).length} require auth)\n`);

  for (const route of routes) {
    const url = `${BASE_URL}${route.path}`;
    const filename = `${route.name}.png`;
    const filepath = path.join(OUTPUT_ROOT, filename);

    process.stdout.write(`  ${route.path}`);
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 15_000 });
      await page.waitForTimeout(1000);
      await page.screenshot({ path: filepath, fullPage: true });
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
