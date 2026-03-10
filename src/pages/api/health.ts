import type { APIRoute } from "astro";
import { prisma } from "../../lib/db.server";

export const GET: APIRoute = async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok" });
  } catch (err: any) {
    return Response.json({ status: "error", message: err?.message ?? "db unreachable" }, { status: 503 });
  }
};
