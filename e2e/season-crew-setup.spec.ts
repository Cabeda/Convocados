import { test, expect, type Page, type APIRequestContext, type Locator } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../e2e-test.db");

function sql(statement: string) {
  execSync(`sqlite3 "${DB_PATH}" "${statement}"`, { stdio: "pipe" });
}

function sqlGet(statement: string): string {
  return execSync(`sqlite3 "${DB_PATH}" "${statement}"`, { encoding: "utf-8" }).trim();
}

const pad = (n: number) => String(n).padStart(2, "0");
function dateInput(daysFromNow: number): string {
  const date = new Date(Date.now() + daysFromNow * 86400_000);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// Unique client IP per spec run, so the shared CI rate-limit buckets used by
// the rest of the suite do not throttle this spec's API setup calls.
let ipCounter = 200;
function withIp(request: APIRequestContext) {
  ipCounter++;
  const ip = `10.99.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`;
  const headers = { "X-Forwarded-For": ip };
  return {
    post: (url: string, opts?: any) => request.post(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
    get: (url: string, opts?: any) => request.get(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
  };
}

// Browser-driven mutations share one rate-limit bucket in CI (no client IP
// header on real browser traffic, 30 writes/min across the whole suite). If a
// submit hits the exhausted bucket, wait out the 60s window and retry once.
async function submitExpecting(page: Page, click: () => Promise<void>, success: Locator) {
  await click();
  try {
    await expect(success).toBeVisible({ timeout: 10_000 });
    return;
  } catch {
    // Fall through: check for the rate-limit alert below.
  }
  const limited = await page.getByText("Too many requests. Please try again later.").count();
  if (limited === 0) throw new Error("submit did not succeed and no rate-limit alert was shown");
  await page.waitForTimeout(65_000);
  await click();
  await expect(success).toBeVisible({ timeout: 15_000 });
}

// Playwright's locator.dragTo() does not reliably trigger HTML5 drag-and-drop,
// so drive a real mouse drag (down → move with steps → up) instead.
async function dragMemberToCrew(page: Page, membershipId: string, crewIndex: number) {
  const source = page.getByTestId(`member-grip-${membershipId}`);
  const target = page.getByTestId(`crew-card-${crewIndex}`);
  await source.scrollIntoViewIfNeeded();
  await target.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await target.boundingBox();
  if (!sourceBox || !targetBox) throw new Error("drag source/target not visible");
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 20 });
  await page.mouse.up();
}

test.describe("Crew Season setup — full happy path", () => {
  test.setTimeout(120_000);

  test("create season, recommend, adjust, save and start", async ({ page }) => {
    const stamp = Date.now();
    const email = `e2e-crew-owner-${stamp}@test.com`;
    const password = "TestPassword123!";
    const api = withIp(page.request);

    // ── 1. Owner account via the real signup API ──────────────────────────
    const signUpRes = await api.post("/api/auth/sign-up/email", {
      data: { email, password, name: "Crew Owner" },
    });
    expect(signUpRes.status()).toBe(200);
    sql(`UPDATE User SET emailVerified = 1 WHERE email = '${email}'`);
    const signInRes = await api.post("/api/auth/sign-in/email", {
      data: { email, password },
    });
    expect(signInRes.status()).toBe(200);

    // ── 2. Event owned by the signed-in user ──────────────────────────────
    const tomorrow = new Date(Date.now() + 86400_000);
    const createRes = await api.post("/api/events", {
      data: {
        title: "E2E Crew Season Game",
        location: "Test Field",
        dateTime: tomorrow.toISOString(),
        maxPlayers: 20,
        sport: "football-5v5",
      },
    });
    expect(createRes.status()).toBe(200);
    const { id: eventId } = await createRes.json();
    // Seasons require a competitive (ELO + balanced) event.
    sql(`UPDATE Event SET eloEnabled = 1, balanced = 1 WHERE id = '${eventId}'`);

    // ── 3. Ten account-linked players with ratings ──────────────────────
    // The tenth has no recent games, so bulk-enroll skips them and the UI
    // autocomplete can enroll them into a specific Crew instead.
    const names = Array.from({ length: 10 }, (_, i) => `E2EPlayer${i}`);
    for (const [index, name] of names.entries()) {
      const userId = `e2e-crew-user-${stamp}-${index}`;
      sql(
        `INSERT INTO User (id, name, email, emailVerified, createdAt, updatedAt) ` +
          `VALUES ('${userId}', '${name}', '${userId}@test.com', 1, datetime('now'), datetime('now'))`,
      );
      const addRes = await api.post(`/api/events/${eventId}/players`, { data: { name } });
      expect(addRes.status()).toBe(200);
      sql(`UPDATE EventPlayer SET userId = '${userId}' WHERE eventId = '${eventId}' AND name = '${name}'`);
      // Adding a player auto-creates its PlayerRating row — just set the rating.
      sql(`UPDATE PlayerRating SET rating = ${1000 + index * 50}, gamesPlayed = 4 WHERE eventId = '${eventId}' AND name = '${name}'`);
    }

    // ── 4. Create the Season through the UI ───────────────────────────────
    const opens = dateInput(-1);
    const closes = dateInput(30);
    await page.goto(`/events/${eventId}/seasons`);
    await page.getByRole("button", { name: "Start a new season" }).click();
    await page.getByLabel("Season name").fill("E2E Season");
    await page.getByLabel("Registration opens").fill(opens);
    await page.getByLabel("Registration closes").fill(closes);
    await submitExpecting(
      page,
      () => page.getByRole("button", { name: "Create season", exact: true }).click(),
      page.getByRole("link", { name: /E2E Season/ }),
    );
    // Creation stays on the list — open the new Season from its card.
    await page.getByRole("link", { name: /E2E Season/ }).first().click();
    await page.waitForURL(/\/seasons\//, { timeout: 10_000 });
    const seasonId = page.url().split("/seasons/")[1];
    expect(seasonId).toBeTruthy();

    // GH-915: the starting date is pre-filled from the registration period.
    await expect(page.getByLabel("Season starting date")).toHaveValue(opens);

    // ── 5. Enroll the nine players via "Add recent players" ─────────────
    // A recent game with nine attending. (Adding a player auto-joins them to
    // the current game roster, so clear those rows first for determinism.)
    sql(`DELETE FROM GameParticipant WHERE eventPlayerId IN (SELECT id FROM EventPlayer WHERE eventId = '${eventId}')`);
    const playersJson = sqlGet(
      `SELECT json_group_array(json_object('id', id, 'userId', userId)) FROM (SELECT id, userId FROM EventPlayer WHERE eventId = '${eventId}' ORDER BY rowid)`,
    );
    const players = JSON.parse(playersJson) as Array<{ id: string; userId: string }>;
    expect(players).toHaveLength(10);
    sql(
      `INSERT INTO Game (id, eventId, dateTime, status, createdAt, updatedAt) ` +
        `VALUES ('e2e-game-${stamp}', '${eventId}', ${Date.now()}, 'played', datetime('now'), datetime('now'))`,
    );
    // Only the first nine attended: E2EPlayer9 stays out for the autocomplete step.
    for (const [index, player] of players.slice(0, 9).entries()) {
      sql(
        `INSERT INTO GameParticipant (id, gameId, eventPlayerId, status, createdAt) ` +
          `VALUES ('e2e-gp-${stamp}-${index}', 'e2e-game-${stamp}', '${player.id}', 'active', datetime('now'))`,
      );
    }
    await submitExpecting(
      page,
      () => page.getByRole("button", { name: "Add recent players" }).click(),
      page.getByText("Added 9 players to the season."),
    );
    // Participants are listed without a reload.
    expect(await page.getByTestId(/member-row-/).count()).toBe(9);

    // ── 6. Recommend balanced Crews ───────────────────────────────────────
    await page.getByRole("combobox", { name: "Number of Crews" }).click();
    await page.getByRole("option", { name: "3", exact: true }).click();
    await submitExpecting(
      page,
      () => page.getByRole("button", { name: "Recommend Crews" }).click(),
      page.getByText("Crew ELO", { exact: false }).first(),
    );
    // GH-919: every draft Crew shows its average ELO.
    expect(await page.getByText(/Crew ELO \d+/).count()).toBe(3);

    // ── 7. Add an empty Crew draft (GH-916), then discard it ──────────────
    await page.getByRole("button", { name: "Add crew" }).click();
    await expect(page.locator('input[value="Crew 4"]')).toBeVisible();
    await page.reload();
    await page.getByRole("combobox", { name: "Number of Crews" }).click();
    await page.getByRole("option", { name: "3", exact: true }).click();
    await submitExpecting(
      page,
      () => page.getByRole("button", { name: "Recommend Crews" }).click(),
      page.getByText("Crew ELO", { exact: false }).first(),
    );

    // ── 8. Swap two players via drag and drop (GH-918) ────────────────────
    const seasonRes = await api.get(`/api/events/${eventId}/seasons/${seasonId}`);
    expect(seasonRes.status()).toBe(200);
    const seasonBody = await seasonRes.json();
    // Recommend is preview-only: nothing is persisted until Save.
    expect(seasonBody.season.crews).toEqual([]);
    // The recommend response order is deterministic: first crew holds the top-rated players.
    const firstCrewMembers = await page.getByTestId("crew-card-0").getByTestId(/member-row-/).all();
    expect(firstCrewMembers).toHaveLength(3);
    const movingId = (await firstCrewMembers[0].getAttribute("data-testid"))!.replace("member-row-", "");
    const secondCrewMembers = await page.getByTestId("crew-card-1").getByTestId(/member-row-/).all();
    const swapId = (await secondCrewMembers[0].getAttribute("data-testid"))!.replace("member-row-", "");
    await dragMemberToCrew(page, movingId, 1);
    await dragMemberToCrew(page, swapId, 0);
    // The two players actually swapped crews (not just sizes staying valid).
    await expect(page.getByTestId(`member-row-${movingId}`).getByRole("combobox")).toHaveText("Crew 2");
    await expect(page.getByTestId(`member-row-${swapId}`).getByRole("combobox")).toHaveText("Crew 1");
    // Sizes stay 3/3/3: the swap keeps every Crew valid for saving.
    expect(await page.getByTestId("crew-card-0").getByTestId(/member-row-/).count()).toBe(3);
    expect(await page.getByTestId("crew-card-1").getByTestId(/member-row-/).count()).toBe(3);

    // ── 8b. Enroll the tenth player straight into Crew 1 via search ───────
    await page.getByRole("combobox", { name: "Add player to Crew 1" }).click();
    await page.getByRole("combobox", { name: "Add player to Crew 1" }).fill("E2EPlayer9");
    await page.getByRole("option", { name: "E2EPlayer9" }).click();
    await expect(page.getByText("Added E2EPlayer9 to Crew 1.")).toBeVisible({ timeout: 10_000 });
    expect(await page.getByTestId("crew-card-0").getByTestId(/member-row-/).count()).toBe(4);

    // ── 9. Save the setup ─────────────────────────────────────────────────
    await submitExpecting(
      page,
      () => page.getByRole("button", { name: "Save Season setup" }).click(),
      page.getByText("Season setup saved."),
    );

    // ── 10. Start the Season (3 qualifying Crews + 9 participants) ────────
    const startButton = page.getByRole("button", { name: "Start season" });
    await expect(startButton).toBeEnabled();
    await submitExpecting(
      page,
      () => startButton.click(),
      page.getByRole("heading", { name: "Season is active" }),
    );
  });
});
