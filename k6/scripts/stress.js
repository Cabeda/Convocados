import { sleep } from "k6";
import { thresholds } from "../config/thresholds.js";
import { apiGet, apiPost, BASE_URL } from "../lib/helpers.js";
import { randomPlayerName, randomEventPayload } from "../lib/fixtures.js";

/**
 * Stress test — pushes beyond normal capacity to find breaking points.
 *
 * Gradually increases to 1500 VUs, holds, then ramps down.
 * Thresholds are relaxed — the goal is to observe degradation.
 *
 * Usage: k6 run k6/scripts/stress.js
 */
export const options = {
  stages: [
    { duration: "2m", target: 500 },
    { duration: "3m", target: 1000 },
    { duration: "3m", target: 1500 },
    { duration: "5m", target: 1500 },
    { duration: "2m", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<2000"],
    checks: ["rate>0.95"],
  },
};

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
    sleep(2);
  }

  return { sharedEventId: eventId || null };
}

export default function (data) {
  const vu = __VU;
  const iter = __ITER;
  const hasEvent = !!data.sharedEventId;
  const roll = Math.random();

  if (roll < 0.6) {
    apiGet("/api/events/public", { tags: { endpoint: "public_events" } });
  } else if (roll < 0.85) {
    if (hasEvent) {
      const name = randomPlayerName(vu, iter);
      apiPost(
        `/api/events/${data.sharedEventId}/players`,
        { name },
        { tags: { endpoint: "add_player" } }
      );
    } else {
      apiGet("/api/health", { tags: { endpoint: "health" } });
    }
  } else {
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
      apiGet("/api/events/public", { tags: { endpoint: "public_events" } });
      sleep(0.5);
      return;
    }

    for (let i = 0; i < 10; i++) {
      apiPost(
        `/api/events/${eventId}/players`,
        { name: randomPlayerName(vu, i) },
        { tags: { endpoint: "add_player" } }
      );
    }

    apiPost(`/api/events/${eventId}/randomize`, {}, {
      tags: { endpoint: "randomize" },
    });
  }

  sleep(0.5);
}
