import type { APIRoute } from "astro";

export const GET: APIRoute = () => {
  const manifest = {
    name: "Convocados Watch",
    short_name: "Watch",
    description: "Track game scores from your wrist.",
    start_url: "/watch/",
    scope: "/watch/",
    display: "standalone",
    background_color: "#111412",
    theme_color: "#1b6b4a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    categories: ["sports"],
    orientation: "portrait-primary",
  };

  return new Response(JSON.stringify(manifest), {
    headers: { "Content-Type": "application/manifest+json" },
  });
};
