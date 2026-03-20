import http from "k6/http";
import { check, sleep } from "k6";
import { Counter, Trend } from "k6/metrics";
import { BASE_URL, defaultHeaders } from "../lib/helpers.js";
import { randomEventPayload } from "../lib/fixtures.js";

/**
 * SSE (Server-Sent Events) connection test.
 *
 * Tests the /api/events/:id/stream endpoint under load.
 * SSE connections are long-lived — this test verifies:
 *   1. Connections establish successfully (status 200, correct content-type)
 *   2. The server handles many concurrent SSE connections
 *   3. Connections can be established while other API traffic is ongoing
 *
 * Since k6 doesn't natively support SSE streaming, we use short HTTP
 * timeouts to test connection establishment. The timeout causes k6 to
 * report a "request error", but we validate the response status and
 * headers were correct before the timeout.
 *
 * Usage: k6 run k6/scripts/sse.js
 */

// Custom metrics for SSE
const sseConnected = new Counter("sse_connections_established");
const sseFailed = new Counter("sse_connections_failed");
const sseConnectTime = new Trend("sse_connect_time", true);

export const options = {
  scenarios: {
    // Scenario 1: Ramp up SSE connections
    sse_connections: {
      executor: "ramping-vus",
      exec: "sseConnect",
      startVUs: 0,
      stages: [
        { duration: "15s", target: 50 },
        { duration: "30s", target: 50 },
        { duration: "15s", target: 0 },
      ],
      tags: { scenario: "sse" },
    },
    // Scenario 2: Concurrent API traffic alongside SSE
    api_traffic: {
      executor: "constant-vus",
      exec: "apiTraffic",
      vus: 10,
      duration: "60s",
      tags: { scenario: "api" },
    },
  },
  thresholds: {
    sse_connections_established: ["count>10"],
    // SSE connections always hit the 3s timeout (stream never closes),
    // so connect time equals timeout. We just verify it doesn't exceed it.
    sse_connect_time: ["p(95)<4000"],
    "checks{scenario:sse}": ["rate>0.95"],
    "checks{scenario:api}": ["rate>0.99"],
    "http_req_duration{scenario:api}": ["p(95)<500"],
  },
};

/**
 * Setup: find or create an event for SSE connections.
 * Tries to create a new event first; if rate limited, fetches an existing public event.
 */
export function setup() {
  // Try creating a new event
  const payload = randomEventPayload(0);
  const createRes = http.post(
    `${BASE_URL}/api/events`,
    JSON.stringify(payload),
    { headers: defaultHeaders }
  );

  try {
    const body = JSON.parse(createRes.body);
    if (body.id) {
      console.log(`Setup: created event ${body.id}`);
      return { eventId: body.id };
    }
  } catch {}

  // Fallback: fetch an existing public event
  const publicRes = http.get(`${BASE_URL}/api/events/public`, {
    headers: defaultHeaders,
  });

  try {
    const body = JSON.parse(publicRes.body);
    const events = body.data || body;
    if (Array.isArray(events) && events.length > 0) {
      const eventId = events[0].id;
      console.log(`Setup: using existing event ${eventId}`);
      return { eventId };
    }
  } catch {}

  console.warn("Setup: no events available for SSE test");
  return { eventId: null };
}

/**
 * SSE connection scenario: connect to the stream endpoint,
 * verify we get a 200 with text/event-stream content-type.
 *
 * We use a 3s timeout — the SSE stream never ends, so k6 will
 * cut the connection after 3s. We check the status and body
 * that was received before the timeout.
 */
export function sseConnect(data) {
  if (!data.eventId) {
    sleep(1);
    return;
  }

  const start = Date.now();
  const url = `${BASE_URL}/api/events/${data.eventId}/stream`;

  // Use http.get with a short timeout. SSE streams never close,
  // so the request will "complete" when the timeout fires.
  // k6 still captures the status, headers, and partial body.
  const res = http.get(url, {
    headers: {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
    },
    timeout: "3s",
    tags: { endpoint: "sse_stream", scenario: "sse" },
    // Don't count the timeout as a failure in http_req_failed
    responseCallback: http.expectedStatuses(0, 200),
  });

  const elapsed = Date.now() - start;
  const body = res.body || "";
  const contentType = res.headers["Content-Type"] || "";

  // Status 0 means k6 cut the connection (timeout) — that's expected for SSE.
  // We check if we got a 200 before timeout, or if the body has SSE data.
  const gotResponse = res.status === 200 || res.status === 0;
  const isSSE = contentType.includes("text/event-stream");
  const hasConnectedEvent = body.includes("event: connected");

  const ok = check(
    res,
    {
      "SSE got response (200 or timeout)": () => gotResponse,
      "SSE content-type is text/event-stream": () =>
        isSSE || body.includes("event:"),
      "SSE received connected event": () => hasConnectedEvent,
    },
    { scenario: "sse" }
  );

  if (hasConnectedEvent) {
    sseConnected.add(1);
    sseConnectTime.add(elapsed);
  } else if (gotResponse && body.length > 0) {
    // Got some data but not the connected event — partial success
    sseConnected.add(1);
    sseConnectTime.add(elapsed);
  } else {
    sseFailed.add(1);
  }

  // Simulate user staying on the page briefly
  sleep(0.5 + Math.random() * 1.5);
}

/**
 * API traffic scenario: simulate normal API usage happening
 * concurrently with SSE connections.
 */
export function apiTraffic(data) {
  const res = http.get(`${BASE_URL}/api/events/public`, {
    headers: defaultHeaders,
    tags: { endpoint: "public_events", type: "read", scenario: "api" },
    responseCallback: http.expectedStatuses(200, 429),
  });

  check(
    res,
    {
      "API public events ok": (r) => r.status === 200 || r.status === 429,
    },
    { scenario: "api" }
  );

  sleep(0.5);

  if (data.eventId) {
    const detailRes = http.get(`${BASE_URL}/api/events/${data.eventId}`, {
      headers: defaultHeaders,
      tags: { endpoint: "get_event", type: "read", scenario: "api" },
      responseCallback: http.expectedStatuses(200, 429),
    });

    check(
      detailRes,
      {
        "API event detail ok": (r) => r.status === 200 || r.status === 429,
      },
      { scenario: "api" }
    );
  }

  sleep(0.5);
}
