import { sleep, check } from "k6";
import { thresholds } from "../config/thresholds.js";
import { apiGet, apiPost, BASE_URL } from "../lib/helpers.js";
import { randomPlayerName, randomEventPayload } from "../lib/fixtures.js";

/**
 * Load test — simulates normal production traffic with 1000 concurrent users.
 *
 * Stages:
 *   1. Ramp up to 1000 VUs over 5 minutes
 *   2. Sustain 1000 VUs for 10 minutes
 *   3. Ramp down over 2 minutes
 *
 * Usage: k6 run k6/scripts/load.js
 * Override target: k6 run -e K6_BASE_URL=https://staging.example.com k6/scripts/load.js
 */
export const options = {
  stages: [
    { duration: "5m", target: 1000 },
    { duration: "10m", target: 1000 },
    { duration: "2m", target: 0 },
  ],
  thresholds,
};

/**
 * Setup: create a shared event that all VUs will interact with.
 * Retries a few times in case of rate limiting.
 */
export function setup() {
  let eventId;
  for (let attempt = 0; attempt < 5; attempt++) {
    const payload = randomEventPayload(attempt);
    const res = apiPost("/api/events", payload, {
      tags: { endpoint: "setup_create_event" },
    });
    try {
      const body = JSON.parse(res.body);
      if (body.id) {
        eventId = body.id;
        break;
      }
    } catch {}
    sleep(2); // wait for rate limit window to pass
  }

  if (!eventId) {
    console.warn("Setup: could not create shared event — tests will use read-only flows");
  }

  return { sharedEventId: eventId || null };
}

export default function (data) {
  const vu = __VU;
  const iter = __ITER;
  const hasEvent = !!data.sharedEventId;

  // ── Scenario mix (weighted by real-world usage) ──────────────────────
  // 50%: browse public events (read)
  // 30%: join player flow (write + read)
  // 15%: view individual event (read)
  //  5%: full event lifecycle (write-heavy)

  const roll = Math.random();

  if (roll < 0.5) {
    // ── Browse public events ──────────────────────────────────────────
    apiGet("/api/events/public", { tags: { endpoint: "public_events" } });
    sleep(1);
  } else if (roll < 0.8) {
    // ── Join player flow ──────────────────────────────────────────────
    if (hasEvent) {
      const name = randomPlayerName(vu, iter);
      apiPost(
        `/api/events/${data.sharedEventId}/players`,
        { name },
        { tags: { endpoint: "add_player" } }
      );
      sleep(0.5);
      apiGet(`/api/events/${data.sharedEventId}`, {
        tags: { endpoint: "get_event" },
      });
      sleep(0.5);
    } else {
      apiGet("/api/health", { tags: { endpoint: "health" } });
      apiGet("/api/events/public", { tags: { endpoint: "public_events" } });
      sleep(1);
    }
  } else if (roll < 0.95) {
    // ── View individual event ─────────────────────────────────────────
    if (hasEvent) {
      apiGet(`/api/events/${data.sharedEventId}`, {
        tags: { endpoint: "get_event" },
      });
    } else {
      apiGet("/api/events/public", { tags: { endpoint: "public_events" } });
    }
    sleep(1);
  } else {
    // ── Full event lifecycle ──────────────────────────────────────────
    const payload = randomEventPayload(vu);
    const createRes = apiPost("/api/events", payload, {
      tags: { endpoint: "create_event" },
    });

    let eventId;
    try {
      const body = JSON.parse(createRes.body);
      eventId = body.id;
    } catch {}

    if (!eventId) {
      // Rate limited or failed — fall back to reads
      apiGet("/api/events/public", { tags: { endpoint: "public_events" } });
      sleep(1);
      return;
    }

    sleep(0.3);

    for (let i = 0; i < 6; i++) {
      apiPost(
        `/api/events/${eventId}/players`,
        { name: randomPlayerName(vu, i) },
        { tags: { endpoint: "add_player" } }
      );
      sleep(0.1);
    }

    apiPost(`/api/events/${eventId}/randomize`, {}, {
      tags: { endpoint: "randomize" },
    });
    sleep(0.5);

    apiGet(`/api/events/${eventId}`, { tags: { endpoint: "get_event" } });
    sleep(0.5);
  }
}
