#!/usr/bin/env node
/**
 * Seed the account OpenAI's ChatGPT app review signs in with, plus the demo
 * games its test cases run against.
 *
 * The account itself has to exist *verified*, and the public sign-up route
 * always emails a verification link — an inbox nobody in this repo can read.
 * So this script signs up through the real route (letting better-auth own the
 * password hash and the Account row), flips `User.emailVerified` for that one
 * row, and creates everything else through the public HTTP API as that user, so
 * every row is exactly what the app writes when an organizer does it by hand.
 *
 * Idempotent: events are keyed by (owner, title) and reused on a re-run.
 *
 *   BASE_URL=http://127.0.0.1:3000 DB_PATH=/data/db.sqlite \
 *   REVIEWER_EMAIL=mcp-review@theaicompany.org REVIEWER_PASSWORD=... \
 *   node scripts/seed-reviewer-demo.mjs
 */
import Database from "better-sqlite3";

const BASE = (process.env.BASE_URL ?? "http://127.0.0.1:3000").replace(/\/$/, "");
// better-auth rejects a write whose Origin is not one of its trusted origins,
// and in production that is the public host — not the loopback address this
// script talks to.
const ORIGIN = (process.env.ORIGIN ?? process.env.BETTER_AUTH_URL ?? BASE).replace(/\/$/, "");
const DB_PATH = process.env.DB_PATH ?? "dev.db";
const EMAIL = process.env.REVIEWER_EMAIL ?? "mcp-review@theaicompany.org";
const PASSWORD = process.env.REVIEWER_PASSWORD;
const NAME = "OpenAI Review";

if (!PASSWORD) {
  console.error("REVIEWER_PASSWORD is required.");
  process.exit(2);
}

const db = new Database(DB_PATH);

/** One fetch against the app, carrying the reviewer's cookie once signed in. */
let cookie = "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function api(path, { method = "GET", body, expect = [200, 201] } = {}) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        "content-type": "application/json",
        // better-auth demands an Origin; the app's own CSRF guard (which these
        // calls bypass) is the one that rejects a mismatched one.
        ...(path.startsWith("/api/auth/") ? { origin: ORIGIN } : {}),
        ...(cookie ? { cookie } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const setCookies = res.headers.getSetCookie?.() ?? [];
    if (setCookies.length) cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
    const text = await res.text();
    if (res.status === 429 && attempt <= 3) {
      // The app allows 30 writes a minute; a whole demo is just over that.
      const wait = Number(res.headers.get("retry-after")) * 1000 || 61_000;
      console.log(`rate limited on ${method} ${path} — waiting ${Math.round(wait / 1000)}s`);
      await sleep(wait);
      continue;
    }
    let json;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    if (!expect.includes(res.status)) {
      throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return json;
  }
}

async function ensureAccount() {
  // Ask the database first: signing up twice burns the per-IP sign-up budget
  // (5/hour) for no reason, and a re-run only needs the sign-in half.
  const existing = db.prepare("SELECT id FROM User WHERE email = ?").get(EMAIL);
  if (existing) {
    console.log("account: already existed");
  } else {
    const signUp = await fetch(`${BASE}/api/auth/sign-up/email`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: ORIGIN },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD, name: NAME }),
    });
    if (!signUp.ok) {
      throw new Error(`sign-up failed (${signUp.status}): ${(await signUp.text()).slice(0, 300)}`);
    }
    console.log("account: created via the public sign-up route");
  }

  const verified = db.prepare("UPDATE User SET emailVerified = 1 WHERE email = ?").run(EMAIL);
  console.log(`account: emailVerified rows touched = ${verified.changes}`);

  await api("/api/auth/sign-in/email", { method: "POST", body: { email: EMAIL, password: PASSWORD } });
  const session = await api("/api/auth/get-session");
  const userId = session?.user?.id;
  if (!userId) throw new Error(`could not read the signed-in user id: ${JSON.stringify(session)}`);
  console.log(`account: signed in as ${EMAIL} (${userId})`);
  return userId;
}

function isoAt(daysFromNow, hour, minute = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  d.setUTCHours(hour, minute, 0, 0);
  return d.toISOString();
}

const PLAYERS = [
  "Alex Costa", "Bruno Silva", "Diogo Matos", "Filipe Rocha",
  "Gonçalo Nunes", "Hugo Prazeres", "Inês Tavares", "Joana Pinto",
];

/** Create the event unless this owner already has one with that title. */
async function ensureEvent(ownerId, spec) {
  const existing = db
    .prepare("SELECT id FROM Event WHERE ownerId = ? AND title = ? LIMIT 1")
    .get(ownerId, spec.title);
  if (existing) {
    console.log(`event: "${spec.title}" exists (${existing.id})`);
    return { id: existing.id, created: false };
  }
  const { id } = await api("/api/events", { method: "POST", body: spec.event });
  console.log(`event: "${spec.title}" created (${id})`);
  return { id, created: true };
}

async function addPlayers(eventId, names) {
  for (const name of names) {
    try {
      await api(`/api/events/${eventId}/players`, { method: "POST", body: { name } });
    } catch (e) {
      // A re-run hits "already on the roster"; that is the desired end state.
      if (!/already/i.test(String(e.message))) throw e;
    }
    await sleep(120);
  }
  console.log(`roster: ${names.length} players on ${eventId}`);
}

async function ensureCost(eventId, totalAmount, currency = "EUR") {
  await api(`/api/events/${eventId}/cost`, {
    method: "PUT",
    body: {
      totalAmount,
      currency,
      paymentMethods: [{ type: "mbway", value: "912345678" }],
    },
  });
  console.log(`cost: €${totalAmount} split across the roster of ${eventId}`);
}

async function ensureHistory(eventId, game) {
  const before = db
    .prepare("SELECT count(*) AS n FROM GameHistory WHERE eventId = ?")
    .get(eventId);
  if ((before?.n ?? 0) >= game.count) {
    console.log(`history: ${before.n} games already on ${eventId}`);
    return;
  }
  await api(`/api/events/${eventId}/history`, { method: "POST", body: game.body });
  console.log(`history: recorded a played game on ${eventId}`);
}

async function main() {
  const ownerId = await ensureAccount();

  // 1. The game the reviewer organizes: full roster, a cost, and write tools
  //    all work on it (they need the owner to be the caller).
  const monday = await ensureEvent(ownerId, {
    title: "Monday 5-a-side — Parque das Nações",
    event: {
      title: "Monday 5-a-side — Parque das Nações",
      location: "Parque das Nações, Lisbon",
      city: "Lisbon",
      dateTime: isoAt(3, 19),
      timezone: "Europe/Lisbon",
      sport: "football-5v5",
      maxPlayers: 10,
      teamOneName: "Reds",
      teamTwoName: "Blues",
      isPublic: true,
    },
  });
  await addPlayers(monday.id, PLAYERS.slice(0, 6));
  await ensureCost(monday.id, 50);

  // 2. A second public game, half-empty: exercises list_public_events and
  //    "spots left" without the reviewer's own games.
  const thursday = await ensureEvent(ownerId, {
    title: "Thursday Basketball — Campo Grande",
    event: {
      title: "Thursday Basketball — Campo Grande",
      location: "Campo Grande, Lisbon",
      city: "Lisbon",
      dateTime: isoAt(6, 20),
      timezone: "Europe/Lisbon",
      sport: "basketball",
      maxPlayers: 10,
      teamOneName: "Home",
      teamTwoName: "Away",
      isPublic: true,
    },
  });
  await addPlayers(thursday.id, PLAYERS.slice(0, 3));
  await ensureCost(thursday.id, 30);

  // 3. A weekly group with two played games: gives get_history, get_ratings and
  //    get_balance something real to read.
  const sunday = await ensureEvent(ownerId, {
    title: "Sunday Football — Belém",
    event: {
      title: "Sunday Football — Belém",
      location: "Belém, Lisbon",
      city: "Lisbon",
      dateTime: isoAt(2, 10),
      timezone: "Europe/Lisbon",
      sport: "football-7v7",
      maxPlayers: 14,
      teamOneName: "Yellow",
      teamTwoName: "Green",
      isPublic: false,
    },
  });
  await addPlayers(sunday.id, PLAYERS);
  await ensureCost(sunday.id, 70);
  await ensureHistory(sunday.id, {
    count: 1,
    body: {
      dateTime: isoAt(-7, 10),
      teamOneName: "Yellow",
      teamTwoName: "Green",
      scoreOne: 6,
      scoreTwo: 4,
      teamsSnapshot: [
        { team: "Yellow", players: PLAYERS.slice(0, 4).map((name, order) => ({ name, order })) },
        { team: "Green", players: PLAYERS.slice(4).map((name, order) => ({ name, order })) },
      ],
    },
  });

  console.log("\n──────────────────────────────────────────────────────");
  console.log("Reviewer demo ready");
  console.log("──────────────────────────────────────────────────────");
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: (the one you set as REVIEWER_PASSWORD)`);
  console.log(`  Games:    ${monday.id}  Monday 5-a-side (full roster, €50)`);
  console.log(`            ${thursday.id}  Thursday Basketball (3/10, €30)`);
  console.log(`            ${sunday.id}  Sunday Football (8/14, history + ratings)`);
  console.log("──────────────────────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.close());
