import { test, expect } from "@playwright/test";

/**
 * iOS derives the installed home-screen app name (and the sender label on
 * web-push notifications) from `apple-mobile-web-app-title` when present, and
 * otherwise falls back to the page <title>. Event pages put the event name in
 * <title>, so without the explicit meta the icon gets named after whichever
 * event it was installed from (prod bug: "Ninjas da Areosa — Convocados").
 */

// Mutations are rate limited per IP (30/min). The suite already creates events
// from the default IP, so give this spec its own to stay independent of
// ordering. Mirrors e2e/notifications.spec.ts.
let ipCounter = 300;
function uniqueIp(): string {
  ipCounter++;
  return `10.97.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`;
}

test.describe("PWA home-screen app name", () => {
  test("event page pins the app name to Convocados, not the event title", async ({ request }) => {
    const headers = { "X-Forwarded-For": uniqueIp() };

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(20, 0, 0, 0);

    const createRes = await request.post("/api/events", {
      headers,
      data: {
        title: "PWA App Name Game",
        dateTime: tomorrow.toISOString(),
        maxPlayers: 10,
        sport: "football-5v5",
      },
    });
    expect(createRes.status()).toBe(200);
    const { id } = await createRes.json();

    const res = await request.get(`/events/${id}`, { headers });
    expect(res.status()).toBe(200);
    const html = await res.text();

    // The page title legitimately carries the event name for tabs and SEO...
    expect(html).toMatch(/<title>PWA App Name Game — Convocados<\/title>/);
    // ...but iOS must not use it as the installed app name.
    expect(html).toMatch(
      /<meta name="apple-mobile-web-app-title" content="Convocados"\s*\/?>/,
    );
  });
});
