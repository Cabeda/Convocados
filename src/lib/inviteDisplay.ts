/**
 * How a pending invite is shown on the event page: which channels it went out
 * through and whether it can be sent again yet. Pure, so every rule is a unit test.
 */

/** ADR 0025 follow-up: minimum time between invite deliveries (mirrors the server's RESEND_COOLDOWN_MS). */
export const RESEND_COOLDOWN_MS = 24 * 60 * 60 * 1000;

/** Whether a pending invite can be resent, and how much cooldown remains. */
export function resendEligibility(
  notifiedAt: string | null | undefined,
  nowMs: number,
): { eligible: boolean; remainingMs: number } {
  if (!notifiedAt) return { eligible: true, remainingMs: 0 };
  const elapsed = nowMs - new Date(notifiedAt).getTime();
  const remainingMs = Math.max(0, RESEND_COOLDOWN_MS - elapsed);
  return { eligible: remainingMs <= 0, remainingMs };
}

/** Remaining cooldown as "23h 5m" / "42m". */
export function formatCooldown(remainingMs: number): string {
  const totalMin = Math.ceil(remainingMs / 60_000);
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  }
  return `${totalMin}m`;
}

export interface InviteChannelFlags {
  email: boolean;
  webPush: boolean;
  appPush: boolean;
}

export type InviteChannelLabelKey = "channelEmail" | "channelWebPush" | "channelAppPush";

/** Which channels a pending invite was sent through, in a fixed order. */
export function sentChannels(channels: InviteChannelFlags | undefined): Array<{ key: "email" | "web" | "app"; labelKey: InviteChannelLabelKey }> {
  if (!channels) return [];
  const out: Array<{ key: "email" | "web" | "app"; labelKey: InviteChannelLabelKey }> = [];
  if (channels.email) out.push({ key: "email", labelKey: "channelEmail" });
  if (channels.webPush) out.push({ key: "web", labelKey: "channelWebPush" });
  if (channels.appPush) out.push({ key: "app", labelKey: "channelAppPush" });
  return out;
}

/** The earliest moment any of these invites may be sent again, or null when none is cooling down. */
export function earliestResendAt(notifiedAts: ReadonlyArray<string | null | undefined>, nowMs: number): number | null {
  let earliest: number | null = null;
  for (const at of notifiedAts) {
    const { eligible } = resendEligibility(at, nowMs);
    if (eligible || !at) continue;
    const when = new Date(at).getTime() + RESEND_COOLDOWN_MS;
    if (earliest === null || when < earliest) earliest = when;
  }
  return earliest;
}
