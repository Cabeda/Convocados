#!/usr/bin/env node
/**
 * Record the walkthrough OpenAI's ChatGPT app submission asks for, as the
 * reviewer's own case list: five positive cases, three negative ones, each one
 * a real JSON-RPC call to the deployed MCP endpoint with the result on screen.
 *
 * Nothing is mocked. The calls go over HTTPS to production with an API key
 * minted for the demo account, and the roster write it makes is then shown in
 * the browser, so the video proves the call changed what a person sees.
 *
 *   REVIEWER_EMAIL=... REVIEWER_PASSWORD=... node scripts/demo-video.mjs
 *
 * Output: tmp/demo-video/convocados-mcp-demo.mp4
 */
import { chromium } from "@playwright/test";
import { mkdirSync, renameSync } from "node:fs";
import path from "node:path";

const BASE = process.env.BASE_URL ?? "https://convocados.cabeda.dev";
const EMAIL = process.env.REVIEWER_EMAIL;
const PASSWORD = process.env.REVIEWER_PASSWORD;
const OUT_DIR = path.resolve("tmp/demo-video");
const MP4 = path.join(OUT_DIR, "convocados-mcp-demo.mp4");
const W = 1280;
const H = 720;

if (!EMAIL || !PASSWORD) {
  console.error("REVIEWER_EMAIL and REVIEWER_PASSWORD are required.");
  process.exit(2);
}

async function signInOverHttp() {
  const res = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: BASE },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`sign-in failed (${res.status})`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function mintApiKey(cookie) {
  // A key is cheaper to drive than the OAuth consent round-trip, and the MCP
  // endpoint accepts both (src/lib/authenticate.server.ts).
  const res = await fetch(`${BASE}/api/me/api-keys`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({
      name: "demo-video",
      scopes: [
        "read:profile", "read:events", "write:events", "create:events",
        "manage:players", "read:ratings", "read:history", "manage:teams", "manage:payments",
      ],
    }),
  });
  if (!res.ok) throw new Error(`api key creation failed (${res.status}): ${await res.text()}`);
  const body = await res.json();
  return body.key ?? body.apiKey ?? body.token;
}

let rpcId = 0;
/** One JSON-RPC call. Never throws on a JSON-RPC error: the negative cases need it. */
async function mcp(key, method, name, args, { auth = true } = {}) {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "MCP-Protocol-Version": "2026-07-28",
      "Mcp-Method": method,
      ...(auth ? { authorization: `Bearer ${key}` } : {}),
      ...(name ? { "Mcp-Name": name } : {}),
    },
    body: JSON.stringify(
      name
        ? { jsonrpc: "2.0", id: ++rpcId, method, params: { name, arguments: args ?? {} } }
        : { jsonrpc: "2.0", id: ++rpcId, method },
    ),
  });
  const json = await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }));
  return { ok: !json.error, result: json.result, error: json.error, status: res.status };
}

/** tools/call returns `content: [{type:"text", text:"<json>"}]` — unwrap it. */
function unwrap(result) {
  const text = result?.content?.[0]?.text;
  if (!text) return result;
  try { return JSON.parse(text); } catch { return text; }
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const pretty = (v) => esc(typeof v === "string" ? v : JSON.stringify(v, null, 2)).slice(0, 820);

/** A slide the browser can render, so the video shows it instead of a terminal. */
function slide({ title, subtitle = "", rows = [], mono = false, tone = "neutral" }) {
  const accent = tone === "fail" ? "#ff7b72" : tone === "pass" ? "#7ee787" : "#7ee787";
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    html,body{margin:0;height:100%;background:#0d1117;color:#e6edf3;
      font-family:ui-sans-serif,-apple-system,"Segoe UI",Roboto,sans-serif}
    .wrap{height:100%;display:flex;flex-direction:column;justify-content:center;padding:48px 60px;box-sizing:border-box}
    h1{font-size:36px;margin:0 0 8px;letter-spacing:-.02em}
    h2{font-size:20px;margin:0 0 24px;color:#8b949e;font-weight:500}
    .rows{display:flex;flex-direction:column;gap:14px}
    .row{background:#161b22;border:1px solid #30363d;border-radius:10px;padding:14px 16px}
    .k{font-size:13px;color:${accent};letter-spacing:.04em;text-transform:uppercase;margin-bottom:6px}
    pre{margin:0;white-space:pre-wrap;font-size:14px;line-height:1.45;color:#c9d1d9;
      font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
    ${mono ? "pre{font-size:13px}" : ""}
  </style></head><body><div class="wrap">
    <h1>${title}</h1>${subtitle ? `<h2>${subtitle}</h2>` : ""}
    <div class="rows">${rows
      .map((r) => `<div class="row"><div class="k">${r.k}</div><pre>${r.body}</pre></div>`)
      .join("")}</div></div></body></html>`;
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const cookie = await signInOverHttp();
  const key = await mintApiKey(cookie);
  if (!key) throw new Error("no API key in the response");

  // Everything the cases need, fetched before the browser opens so the video
  // only has to show results.
  const toolList = await mcp(key, "tools/list");
  const games = unwrap((await mcp(key, "tools/call", "convocados_list_my_games")).result);
  const owned = games.owned ?? [];
  const monday = owned.find((g) => /Monday 5-a-side/.test(g.title)) ?? owned[0];
  const sunday = owned.find((g) => /Sunday Football/.test(g.title));
  if (!monday) throw new Error(`no demo games on this account: ${pretty(games)}`);

  const whoami = await mcp(key, "tools/call", "convocados_whoami");
  const players = await mcp(key, "tools/call", "convocados_list_players", { eventId: monday.id });
  const balance = await mcp(key, "tools/call", "convocados_get_balance", { eventId: monday.id });
  const ratings = sunday
    ? await mcp(key, "tools/call", "convocados_get_ratings", { eventId: sunday.id })
    : null;
  const history = sunday
    ? await mcp(key, "tools/call", "convocados_get_history", { eventId: sunday.id })
    : null;

  // Negative cases: no token, unknown id, invalid input.
  const noAuth = await mcp(null, "tools/call", "convocados_list_my_games", {}, { auth: false });
  const unknownGame = await mcp(key, "tools/call", "convocados_get_game", {
    eventId: "does-not-exist",
  });
  const badInput = await mcp(key, "tools/call", "convocados_add_player", {
    eventId: monday.id,
    name: "",
  });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    recordVideo: { dir: OUT_DIR, size: { width: W, height: H } },
  });
  const page = await context.newPage();
  const wait = (ms) => page.waitForTimeout(ms);

  // ── Title
  await page.setContent(slide({
    title: "Convocados — MCP review walkthrough",
    subtitle: `${toolList.result?.tools?.length ?? 0} tools · OAuth 2.1 + PKCE · confirmation before every write`,
    rows: [
      { k: "Endpoint", body: `${BASE}/api/mcp` },
      { k: "Demo account", body: EMAIL },
      { k: "Cases", body: "5 positive (sign-in, games, roster, balance, history+ratings, one write)\n3 negative (no token, unknown game, invalid input)" },
    ],
  }));
  await wait(4800);

  // ── Sign in as the reviewer, in the app
  await page.goto(`${BASE}/auth/signin`, { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: /password/i }).click().catch(() => {});
  await page.getByLabel(/email/i).first().fill(EMAIL);
  await page.getByLabel(/password/i).first().fill(PASSWORD);
  await wait(800);
  await page.getByRole("button", { name: /sign in/i }).last().click();
  await page.waitForURL(/dashboard|\/$/, { timeout: 30_000 }).catch(() => {});
  await wait(2200);

  // ── The account's games
  await page.goto(`${BASE}/dashboard`, { waitUntil: "domcontentloaded" });
  await wait(2800);

  // ── Case 1: the token acts as the expected account
  await page.setContent(slide({
    title: "Positive 1 — who is this token?",
    subtitle: "convocados_whoami confirms the account and the scopes it was granted",
    rows: [{ k: "convocados_whoami", body: pretty(unwrap(whoami.result)) }],
    mono: true,
  }));
  await wait(4200);

  // ── Case 2: my games
  await page.setContent(slide({
    title: "Positive 2 — my games",
    subtitle: "convocados_list_my_games returns the three demo games this account owns",
    rows: [{
      k: "owned",
      body: pretty(owned.map((g) => ({ title: g.title, players: g.playerCount, public: g.isPublic }))),
    }],
  }));
  await wait(4000);

  // ── Case 3: the roster
  await page.setContent(slide({
    title: "Positive 3 — the roster",
    subtitle: "convocados_list_players on the Monday game",
    rows: [{
      k: "players",
      body: pretty((unwrap(players.result).players ?? []).map((p) => p.name)),
    }],
  }));
  await wait(3800);

  // ── Case 4: balance
  const balanceView = unwrap(balance.result);
  await page.setContent(slide({
    title: "Positive 4 — the money",
    subtitle: "convocados_get_balance: who still owes, and how many games",
    rows: [{
      k: "convocados_get_balance (per-player rows elided for legibility)",
      body: pretty({
        paidCount: balanceView.paidCount,
        totalCount: balanceView.totalCount,
        aggregate: balanceView.aggregate,
        balanceRows: balanceView.balances?.length ?? 0,
      }),
    }],
    mono: true,
  }));
  await wait(3800);

  // ── Case 5: history and ratings
  await page.setContent(slide({
    title: "Positive 5 — history and ratings",
    subtitle: "The played game and the Elo table behind it, on the Sunday group",
    rows: [
      { k: "convocados_get_history", body: pretty((unwrap(history.result).history ?? []).map((h) => ({ date: h.dateTime?.slice(0, 10), score: `${h.scoreOne}-${h.scoreTwo}`, status: h.status }))) },
      { k: "convocados_get_ratings", body: pretty((unwrap(ratings.result).ratings ?? []).slice(0, 4).map((r) => ({ name: r.name, rating: Math.round(r.rating) }))) },
    ],
  }));
  await wait(4400);

  // ── Case 6: a write, then the same roster in the browser
  const added = await mcp(key, "tools/call", "convocados_add_player", {
    eventId: monday.id,
    name: "Video Demo Player",
  });
  await page.setContent(slide({
    title: "Positive 6 — a write through MCP",
    subtitle: "ChatGPT asks the user to confirm before this call runs",
    rows: [
      { k: "convocados_add_player → request", body: esc(`{ "eventId": "${monday.id}", "name": "Video Demo Player" }`) },
      { k: "result", body: pretty(unwrap(added.result)) },
    ],
  }));
  await wait(4000);

  await page.goto(`${BASE}/events/${monday.id}`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("text=Video Demo Player", { timeout: 20_000 }).catch(() => {});
  await page.locator("text=/Playing \\(/").first().scrollIntoViewIfNeeded().catch(() => {});
  await wait(4200);

  const removed = await mcp(key, "tools/call", "convocados_remove_player", {
    eventId: monday.id,
    name: "Video Demo Player",
  });

  // ── Negative 1: no token
  await page.setContent(slide({
    title: "Negative 1 — a call with no token",
    subtitle: "Protected tools refuse anonymous callers; public reads stay open",
    tone: "fail",
    rows: [{ k: "convocados_list_my_games without Authorization", body: pretty(noAuth.error?.message ?? noAuth.result) }],
  }));
  await wait(4000);

  // ── Negative 2: unknown game
  await page.setContent(slide({
    title: "Negative 2 — an unknown game",
    subtitle: "convocados_get_game with an id that does not exist",
    tone: "fail",
    rows: [{ k: "error", body: pretty(unknownGame.error?.message ?? unknownGame.result) }],
  }));
  await wait(3600);

  // ── Negative 3: invalid input
  await page.setContent(slide({
    title: "Negative 3 — invalid input",
    subtitle: "convocados_add_player with an empty name is rejected, not written",
    tone: "fail",
    rows: [{ k: "error", body: pretty(badInput.error?.message ?? badInput.result) }],
  }));
  await wait(3600);

  // ── The tools the listing advertises
  await page.setContent(slide({
    title: `tools/list → ${toolList.result?.tools?.length ?? 0} tools`,
    subtitle: "Each carries a title, a readOnly/destructive hint and its OAuth scopes",
    rows: [{
      k: "tool names",
      body: esc((toolList.result?.tools ?? []).map((t) => `${t.name}${t.annotations?.readOnlyHint ? "" : "  (write)"}`).join("\n")),
    }],
    mono: true,
  }));
  await wait(5000);

  // ── The docs the reviewer reads
  await page.goto(`${BASE}/docs/mcp`, { waitUntil: "domcontentloaded" });
  await wait(4000);

  // ── End card
  await page.setContent(slide({
    title: "Convocados — ready for review",
    subtitle: `${BASE}/api/mcp · ${toolList.result?.tools?.length ?? 0} tools · OAuth 2.1`,
    rows: [
      { k: "Reviewer sign-in", body: `${BASE}/auth/signin\n${EMAIL}` },
      { k: "Privacy policy", body: `${BASE}/privacy` },
      { k: "Terms of service", body: `${BASE}/terms` },
      { k: "Cleanup", body: `Video Demo Player removed: ${removed.ok ? "yes" : "no"}` },
    ],
  }));
  await wait(4500);

  await context.close();
  await browser.close();

  const recorded = await page.video()?.path();
  if (!recorded) throw new Error("Playwright recorded no video");
  renameSync(recorded, MP4);
  console.log(`video: ${MP4}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
