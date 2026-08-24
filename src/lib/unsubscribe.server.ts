import { randomBytes } from "node:crypto";
import { prisma } from "./db.server";

/**
 * Email unsubscribe types — each maps to a single NotificationPreferences
 * field that gets switched off, no login required.
 */
export type UnsubscribeType =
  | "gameInvite"
  | "gameReminder"
  | "weeklySummary"
  | "paymentReminder"
  | "all";

export const UNSUBSCRIBE_TYPES: readonly UnsubscribeType[] = [
  "gameInvite",
  "gameReminder",
  "weeklySummary",
  "paymentReminder",
  "all",
];

export function isUnsubscribeType(value: string | null | undefined): value is UnsubscribeType {
  return !!value && (UNSUBSCRIBE_TYPES as readonly string[]).includes(value);
}

function generateToken(): string {
  return randomBytes(32).toString("hex");
}

/** Get or create the per-user token embedded in email footer links. */
export async function getOrCreateUnsubscribeToken(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { emailUnsubscribeToken: true },
  });
  if (user?.emailUnsubscribeToken) return user.emailUnsubscribeToken;

  const token = generateToken();
  await prisma.user.update({ where: { id: userId }, data: { emailUnsubscribeToken: token } });
  return token;
}

/**
 * Token lookup by recipient email — used when building footers inside send
 * functions, which only know the destination address. Returns null for
 * recipients without a Convocados account (e.g. one-time invites).
 */
export async function getOrCreateUnsubscribeTokenByEmail(email: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, emailUnsubscribeToken: true },
  });
  if (!user) return null;
  if (user.emailUnsubscribeToken) return user.emailUnsubscribeToken;

  const token = generateToken();
  await prisma.user.update({ where: { id: user.id }, data: { emailUnsubscribeToken: token } });
  return token;
}

/** Validate a token from an unsubscribe link. Returns null when unknown. */
export async function validateUnsubscribeToken(token: string): Promise<{ userId: string } | null> {
  const user = await prisma.user.findUnique({
    where: { emailUnsubscribeToken: token },
    select: { id: true },
  });
  if (!user) return null;
  return { userId: user.id };
}

const FIELD_FOR_TYPE: Record<Exclude<UnsubscribeType, "all">, "gameInviteEmail" | "gameReminderEmail" | "weeklySummaryEmail" | "paymentReminderEmail"> = {
  gameInvite: "gameInviteEmail",
  gameReminder: "gameReminderEmail",
  weeklySummary: "weeklySummaryEmail",
  paymentReminder: "paymentReminderEmail",
};

/**
 * Switch off exactly one email channel ("all" = master emailEnabled switch).
 * Idempotent; creates the preferences row with defaults when missing so a
 * first-time clicker still gets a persisted record.
 */
export async function applyUnsubscribe(userId: string, type: UnsubscribeType): Promise<void> {
  if (type === "all") {
    await prisma.notificationPreferences.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    await prisma.notificationPreferences.update({
      where: { userId },
      data: { emailEnabled: false },
    });
    return;
  }

  await prisma.notificationPreferences.upsert({
    where: { userId },
    create: { userId },
    update: {},
  });
  await prisma.notificationPreferences.update({
    where: { userId },
    data: { [FIELD_FOR_TYPE[type]]: false },
  });
}
