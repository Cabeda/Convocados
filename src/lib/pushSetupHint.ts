/**
 * Enqueue an in-app "you should turn on notifications" hint after a user
 * follows an event but doesn't have a registered device for push.
 *
 * Bounded by a 7-day cooldown per user so returning users don't get spammed.
 */

import { prisma } from "./db.server";
import { createLogger } from "./logger.server";
import { createT } from "./i18n";

const log = createLogger("push-setup-hint");

/** Per-user cooldown between push_setup_hint notifications. */
export const PUSH_SETUP_HINT_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;

const IN_APP_TYPE = "push_setup_hint" as const;
const DEEP_LINK = "/settings?focus=notifications";

/**
 * Enqueue a single push_setup_hint InAppNotification for the user.
 *
 * No-ops if a recent hint already exists (within PUSH_SETUP_HINT_COOLDOWN_MS).
 * Always tied to the originating eventId for context, so the in-app feed can
 * deep-link to that event later if needed.
 */
export async function enqueuePushSetupHint(
  userId: string,
  eventId: string | null,
  now: Date = new Date(),
): Promise<void> {
  const recent = await prisma.inAppNotification.findFirst({
    where: {
      userId,
      type: IN_APP_TYPE,
      createdAt: { gte: new Date(now.getTime() - PUSH_SETUP_HINT_COOLDOWN_MS) },
    },
    orderBy: { createdAt: "desc" },
  });
  if (recent) return;

  // Localized body — keep it short and actionable.
  const t = createT("en");
  const title = t("pushSetupHintTitle");
  const body = t("pushSetupHintBody");

  await prisma.inAppNotification.create({
    data: {
      userId,
      eventId,
      type: IN_APP_TYPE,
      title,
      body,
      url: DEEP_LINK,
    },
  });
}

/**
 * Fire-and-forget variant — never throws. Use from hot paths
 * (event-follow endpoints) where a failed nudge shouldn't fail the user action.
 */
export function enqueuePushSetupHintSafe(
  userId: string,
  eventId: string | null,
): void {
  enqueuePushSetupHint(userId, eventId).catch((err: unknown) => {
    log.warn({ err, userId, eventId }, "Failed to enqueue push setup hint");
  });
}
