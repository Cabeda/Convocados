import { sleep } from "k6";
import { apiGet, apiPost } from "../lib/helpers.js";
import { randomPlayerName, randomEventPayload } from "../lib/fixtures.js";

/**
 * Spike test — simulates sudden traffic bursts.
 *
 * Jumps from 100 to 1000 VUs instantly, holds briefly,
 * drops back, then spikes again. Tests recovery behavior.
 *
 * Usage: k6 run k6/scripts/spike.js
 */
export const options = {
  stages: [
    { duration: "1m", target: 100 },
    { duration: "10s", target: 1000 },
    { duration: "3m", target: 1000 },
    { duration: "10s", target: 100 },
    { duration: "2m", target: 100 },
    { duration: "10s", target: 1000 },
    { duration: "3m", target: 1000 },
    { duration: "1m", target: 0 },
  ],
  thresholds: {
    http_req_failed: ["rate<0.03"],
    http_req_duration: ["p(95)<1000"],
    checks: ["rate>0.97"],
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

  if (roll < 0.5) {
    apiGet("/api/events/public", { tags: { endpoint: "public_events" } });
  } else if (roll < 0.8) {
    if (hasEvent) {
      apiGet(`/api/events/${data.sharedEventId}`, {
        tags: { endpoint: "get_event" },
      });
    } else {
      apiGet("/api/health", { tags: { endpoint: "health" } });
    }
  } else {
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
  }

  sleep(0.3 + Math.random() * 0.7);
}
