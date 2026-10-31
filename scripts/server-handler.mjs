/**
 * The production request handler, extracted from `server.mjs` so a test can
 * boot the real wiring on an `http.Server` instead of only the pure decision.
 *
 * Order matters: the canonical-host redirect runs before the Astro handler
 * because prerendered pages, static files and route-cache hits never reach
 * middleware. Security headers are applied to that response too — it is the
 * only response the retired host serves.
 */
import { canonicalHostRedirect } from "../src/lib/canonicalHost.mjs";

/**
 * @param {{
 *   handler: (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => void,
 *   securityHeaders?: Record<string, string>,
 *   canonicalBaseUrl?: string,
 * }} options
 */
export function createRequestHandler({ handler, securityHeaders = {}, canonicalBaseUrl }) {
  return (req, res) => {
    const redirect = canonicalHostRedirect(req, canonicalBaseUrl);
    if (redirect) {
      // Drain any request body before answering; a 308'd upload otherwise rides
      // the keep-alive connection into the next request.
      req.resume();
      res.writeHead(redirect.status, {
        ...securityHeaders,
        Location: redirect.location,
        "Cache-Control": redirect.cacheControl,
      });
      res.end();
      return;
    }

    // Node routes both explicit res.writeHead() and the implicit header flush in
    // res.end() through this method, so overriding it covers every response —
    // static files, SSR pages and API routes alike.
    const writeHead = res.writeHead.bind(res);
    res.writeHead = (...args) => {
      for (const [key, value] of Object.entries(securityHeaders)) {
        if (!res.hasHeader(key)) res.setHeader(key, value);
      }
      return writeHead(...args);
    };
    handler(req, res);
  };
}
