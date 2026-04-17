import { test, expect, type APIRequestContext } from "@playwright/test";
import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_PATH = path.resolve(__dirname, "../e2e-test.db");

function sql(statement: string) {
  execSync(`sqlite3 "${DB_PATH}" "${statement}"`, { stdio: "pipe" });
}

let ipCounter = 100;
function uniqueIp(): string {
  ipCounter++;
  return `10.88.${Math.floor(ipCounter / 256)}.${ipCounter % 256}`;
}

function withIp(request: APIRequestContext, ip: string) {
  const headers = { "X-Forwarded-For": ip };
  return {
    post: (url: string, opts?: any) =>
      request.post(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
    put: (url: string, opts?: any) =>
      request.put(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
    get: (url: string, opts?: any) =>
      request.get(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
    patch: (url: string, opts?: any) =>
      request.patch(url, { ...opts, headers: { ...headers, ...opts?.headers } }),
  };
}

async function createVerifiedUser(
  request: APIRequestContext,
  email: string,
  password: string,
  name: string,
): Promise<string> {
  await request.post("/api/auth/sign-up/email", {
    data: { email, password, name },
  });
  sql(`UPDATE User SET emailVerified = 1 WHERE email = '${email}'`);
  const signInRes = await request.post("/api/auth/sign-in/email", {
    data: { email, password },
  });
  expect(signInRes.status()).toBe(200);
  const userIdOutput = execSync(
    `sqlite3 "${DB_PATH}" "SELECT id FROM User WHERE email = '${email}'"`,
    { encoding: "utf-8" },
  ).trim();
  return userIdOutput;
}

test.describe("MVP Voting — e2e", () => {
  test.setTimeout(60_000);

  test("vote for MVP after a finished game", async ({ page, request }) => {
    const ip = uniqueIp();
    const api = withIp(request, ip);

    // ── Step 1: Create and authenticate a user ──
    const email = `e2e-mvp-${Date.now()}@test.com`;
    const password = "TestPassword123!";
    const userName = "MVP Voter";

    const userId = await createVerifiedUser(request, email, password, userName);
    expect(userId).toBeTruthy();

    // ── Step 2: Create event ──
    const futureDate = new Date(Date.now() + 86400_000);
    const createRes = await api.post("/api/events", {
      data: {
        title: "E2E MVP Test Game",
        location: "Test Stadium",
        dateTime: futureDate.toISOString(),
        maxPlayers: 4,
        sport: "football-5v5",
      },
    });
    expect(createRes.status()).toBe(200);
    const { id: eventId } = await createRes.json();

    // ── Step 3: Add players (including linking the user to "MVP Voter") ──
    const players = ["MVP Voter", "Alice", "Bob", "Charlie"];
    for (const name of players) {
      const res = await api.post(`/api/events/${eventId}/players`, {
        data: { name },
      });
      expect(res.status()).toBe(200);
    }

    // ── Step 4: Randomize teams ──
    const randomizeRes = await api.post(`/api/events/${eventId}/randomize`, {
      headers: { Origin: "http://localhost:3001", "X-Forwarded-For": ip },
    });
    expect(randomizeRes.status()).toBe(200);

    // Get team data for history
    const eventRes = await api.get(`/api/events/${eventId}`);
    const eventData = await eventRes.json();
    const teamsSnapshot = eventData.teamResults.map((tr: any) => ({
      team: tr.name,
      players: tr.members.map((m: any) => ({ name: m.name, order: m.order })),
    }));

    // ── Step 5: Move event to the past ──
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const dtRes = await api.put(`/api/events/${eventId}/datetime`, {
      data: { dateTime: twoHoursAgo.toISOString(), timezone: "UTC" },
    });
    expect(dtRes.status()).toBe(200);

    // ── Step 6: Add score via history API ──
    const historyRes = await api.post(`/api/events/${eventId}/history`, {
      data: {
        dateTime: twoHoursAgo.toISOString(),
        teamOneName: eventData.teamOneName,
        teamTwoName: eventData.teamTwoName,
        scoreOne: 3,
        scoreTwo: 2,
        teamsSnapshot,
      },
    });
    expect(historyRes.status()).toBe(201);
    const historyData = await historyRes.json();
    const historyId = historyData.id;

    // ── Step 7: Verify MVP API returns voting open ──
    const mvpRes = await api.get(`/api/events/${eventId}/history/${historyId}/mvp`);
    expect(mvpRes.status()).toBe(200);
    const mvpData = await mvpRes.json();
    expect(mvpData.isVotingOpen).toBe(true);
    expect(mvpData.mvp).toBeNull();

    // ── Step 8: Navigate to history page and verify MVP voting UI ──
    await page.goto(`/events/${eventId}/history`);
    await expect(page.locator('[data-testid="mvp-voting"]')).toBeVisible({
      timeout: 15_000,
    });

    // ── Step 9: Click on a player chip to vote ──
    // Find a chip that is NOT the current user (vote for Alice, Bob, or Charlie)
    const voteChip = page.locator('[data-testid="mvp-voting"] .MuiChip-root').filter({
      hasNot: page.locator(`text="${userName}"`),
    }).first();
    await voteChip.click();

    // ── Step 10: Verify success snackbar ──
    await expect(page.locator('.MuiSnackbar-root')).toBeVisible({ timeout: 5_000 });

    // ── Step 11: Verify MVP API now shows hasVoted ──
    const mvpRes2 = await api.get(`/api/events/${eventId}/history/${historyId}/mvp`);
    const mvpData2 = await mvpRes2.json();
    expect(mvpData2.hasVoted).toBe(true);
    expect(mvpData2.totalVotes).toBe(1);
  });
});
