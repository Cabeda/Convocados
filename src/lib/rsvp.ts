export type RsvpStatusValue = "yes" | "no" | "maybe";
export type RsvpStatus = RsvpStatusValue | null;

export const RSVP_STATUS_VALUES: readonly RsvpStatusValue[] = ["yes", "no", "maybe"] as const;

export function isRsvpStatusValue(v: unknown): v is RsvpStatusValue {
  return v === "yes" || v === "no" || v === "maybe";
}
