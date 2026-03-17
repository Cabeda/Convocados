import type { APIRoute } from "astro";
import { prisma } from "../lib/db.server";

export const GET: APIRoute = async ({ request }) => {
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "convocados.fly.dev";
  const proto = request.headers.get("x-forwarded-proto") ?? "https";
  const base = `${proto}://${host}`;

  const publicEvents = await prisma.event.findMany({
    where: { isPublic: true, dateTime: { gte: new Date() } },
    select: { id: true, updatedAt: true },
    orderBy: { dateTime: "asc" },
    take: 1000,
  });

  const staticPages = [
    { loc: "/", priority: "1.0", changefreq: "daily" },
    { loc: "/public", priority: "0.9", changefreq: "hourly" },
    { loc: "/docs", priority: "0.5", changefreq: "weekly" },
  ];

  const urls = [
    ...staticPages.map((p) =>
      `  <url>
    <loc>${base}${p.loc}</loc>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`
    ),
    ...publicEvents.map((e) =>
      `  <url>
    <loc>${base}/events/${e.id}</loc>
    <lastmod>${e.updatedAt.toISOString()}</lastmod>
    <changefreq>daily</changefreq>
    <priority>0.7</priority>
  </url>`
    ),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join("\n")}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
