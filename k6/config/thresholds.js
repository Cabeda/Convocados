/**
 * Shared performance thresholds (SLOs) for all k6 test scripts.
 */
export const thresholds = {
  // HTTP errors should be less than 1%
  http_req_failed: ["rate<0.01"],
  // 95% of requests should complete within 500ms
  http_req_duration: ["p(95)<500"],
  // 99% of requests should complete within 2s
  "http_req_duration{type:read}": ["p(95)<300"],
  "http_req_duration{type:write}": ["p(95)<800"],
  // All checks must pass at >99%
  checks: ["rate>0.99"],
};
