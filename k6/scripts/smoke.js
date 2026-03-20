import { sleep } from "k6";
import { thresholds } from "../config/thresholds.js";
import { apiGet } from "../lib/helpers.js";

/**
 * Smoke test — quick validation that core endpoints respond correctly
 * under minimal load. Run this on every PR.
 *
 * Usage: k6 run k6/scripts/smoke.js
 */
export const options = {
  vus: 5,
  duration: "30s",
  thresholds,
};

export default function () {
  // Health check
  apiGet("/api/health", { tags: { endpoint: "health" } });
  sleep(0.5);

  // Public events listing
  apiGet("/api/events/public", { tags: { endpoint: "public_events" } });
  sleep(0.5);
}
