import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const sw = `
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

const CACHE_NAME = "watch-v1";
const PRECACHE = ["/watch/"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Only handle requests within /watch/ scope
  if (!url.pathname.startsWith("/watch")) return;

  // Network-first for API calls
  if (url.pathname.startsWith("/api/")) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const clone = res.clone();
        caches.open(CACHE_NAME).then((c) => c.put(e.request, clone));
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
`;

  return new Response(sw.trim(), {
    headers: {
      "Content-Type": "application/javascript",
      "Service-Worker-Allowed": "/watch/",
    },
  });
};
