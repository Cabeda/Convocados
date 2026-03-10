import type { APIRoute } from "astro";

export const GET: APIRoute = async () => {
  return Response.json({ publicKey: process.env.VAPID_PUBLIC_KEY ?? "" });
};
