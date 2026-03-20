import http from "k6/http";
import { check } from "k6";

/**
 * Base URL for the target environment.
 * Override with K6_BASE_URL env var.
 */
export const BASE_URL = __ENV.K6_BASE_URL || "http://localhost:4321";

/**
 * Default request headers.
 */
export const defaultHeaders = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

/**
 * HTTP status codes that are "expected" and should not count as failures.
 * 429 = rate limited (expected under load).
 * 409 = conflict (e.g. duplicate player name — expected with concurrent VUs).
 * 400 = bad request (e.g. "Need at least 2 players" for randomize on rate-limited event).
 */
const EXPECTED_NON_200 = new Set([429, 409, 400]);

/**
 * Response callback for k6 — marks 429/409/400 as non-failures
 * so they don't inflate http_req_failed.
 */
const expectedStatuses = {
  responseCallback: http.expectedStatuses(200, 400, 409, 429),
};

/**
 * GET request with standard checks.
 * @param {string} path - API path (e.g. "/api/health")
 * @param {object} [opts] - Extra options: tags, expectedStatus
 */
export function apiGet(path, opts = {}) {
  const { tags = {}, expectedStatus = 200 } = opts;
  const res = http.get(`${BASE_URL}${path}`, {
    headers: defaultHeaders,
    tags: { type: "read", ...tags },
    ...expectedStatuses,
  });
  check(res, {
    [`GET ${path} ok`]: (r) =>
      r.status === expectedStatus || EXPECTED_NON_200.has(r.status),
  });
  return res;
}

/**
 * POST request with standard checks.
 * @param {string} path - API path
 * @param {object} body - JSON body
 * @param {object} [opts] - Extra options: tags, expectedStatus
 */
export function apiPost(path, body, opts = {}) {
  const { tags = {}, expectedStatus = 200 } = opts;
  const res = http.post(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: defaultHeaders,
    tags: { type: "write", ...tags },
    ...expectedStatuses,
  });
  check(res, {
    [`POST ${path} ok`]: (r) =>
      r.status === expectedStatus || EXPECTED_NON_200.has(r.status),
  });
  return res;
}

/**
 * DELETE request with standard checks.
 */
export function apiDelete(path, body, opts = {}) {
  const { tags = {}, expectedStatus = 200 } = opts;
  const res = http.del(`${BASE_URL}${path}`, JSON.stringify(body), {
    headers: defaultHeaders,
    tags: { type: "write", ...tags },
    ...expectedStatuses,
  });
  check(res, {
    [`DELETE ${path} ok`]: (r) =>
      r.status === expectedStatus || EXPECTED_NON_200.has(r.status),
  });
  return res;
}
