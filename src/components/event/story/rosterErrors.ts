import { ApiError } from "~/lib/api/client";
import type { TFunction } from "~/lib/i18n";

/**
 * A roster request that failed, in plain words in the viewer's language. The server's own
 * message is an English sentence for developers, so it is matched, never shown.
 */
export function rosterErrorMessage(reason: unknown, t: TFunction, ctx: { maxPlayers: number; fallback: string; name: string }): string {
  if (!(reason instanceof ApiError)) return ctx.fallback;
  const code = (reason.payload as { code?: unknown } | undefined)?.code;
  const said = reason.serverMessage ?? "";
  if (reason.status === 409 && code === "ALREADY_IN_ROSTER") return t("ngAlreadyIn", { name: ctx.name });
  if (reason.status === 409 && /cancelled/i.test(said)) return t("cancelledBodyPlayer");
  if (reason.status === 403 && /already ended/i.test(said)) return t("ngGameEnded");
  if (reason.status === 400 && /bench is full/i.test(said)) return t("benchFull", { max: ctx.maxPlayers });
  if (reason.status === 429) return t("ngTooFast");
  return ctx.fallback;
}

/**
 * A failed invite (by email or as a link), in the same plain words as a failed add — a rate limit says the same
 * thing on both paths, and the server's own sentence is matched, never shown.
 */
export function inviteErrorMessage(reason: unknown, t: TFunction, ctx: { name: string; fallback: string }): string {
  if (!(reason instanceof ApiError)) return ctx.fallback;
  const said = reason.serverMessage ?? "";
  if (reason.status === 429) return t("ngTooFast");
  if (reason.status === 403) return t("ngInviteNotAllowed");
  if (reason.status === 409 && /declined/i.test(said)) return t("ngDeclinedAlready", { name: ctx.name });
  if (reason.status === 409) return t("ngAlreadyIn", { name: ctx.name });
  if (reason.status === 400 && /already started/i.test(said)) return t("ngGameEnded");
  return ctx.fallback;
}
