import type { APIRoute } from "astro";

export const GET: APIRoute = async () => {
  const publicKey = import.meta.env.VAPID_PUBLIC_KEY ?? process.env.VAPID_PUBLIC_KEY ?? "";
  return Response.json({ publicKey });
};
