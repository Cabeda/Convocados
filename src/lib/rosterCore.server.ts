/**
 * Single place for roster mutations — add (active) vs invite (pending).
 *
 * Both POST /api/events/[id]/players (direct add) and
 * POST /api/events/[id]/invites (pending invite) funnel through here for the
 * shared steps: resolve target user (by userId / email / name), upsert
 * EventPlayer, and create/update the GameParticipant with the correct status.
 *
 * Callers remain responsible for their own side-effects (teams, webhooks,
 * emails, PlayerInvite row, etc.) — this module only ensures the roster
 * identity + membership rows are handled consistently.
 */

import { prisma } from "./db.server";
import { normalizeForMatch } from "./stringMatch";
import { nextGameParticipantOrder } from "./game.server";

export type RosterTarget = {
  /** Resolved display name (trimmed, 50 chars) — always present. */
  name: string;
  /** Linked User.id when the target is a registered account, otherwise null. */
  userId: string | null;
  /** The User row when userId is set, otherwise null. */
  user: { id: string; name: string } | null;
};

export type ResolveTargetInput = {
  /** Raw name from the client (may be empty when email resolves). */
  name?: string | null;
  /** Optional email — lower-cased before lookup. */
  email?: string | null;
  /** Explicit userId (takes precedence over email/name). */
  userId?: string | null;
};

/**
 * Resolve who the roster entry is for.
 *
 * Priority: explicit userId > email that matches a User > name that
 * uniquely matches a User > anonymous (name only).
 *
 * Returns the canonical name (User.name when linked, otherwise the
 * trimmed client name) and the linked userId when applicable.
 */
export async function resolveRosterTarget(
  input: ResolveTargetInput,
): Promise<RosterTarget> {
  const rawName = typeof input.name === "string" ? input.name.trim().slice(0, 50) : "";
  const normalizedEmail =
    typeof input.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())
      ? input.email.trim().toLowerCase()
      : null;

  // 1. Explicit userId — fetch that user directly.
  if (input.userId) {
    const user = await prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true, name: true },
    });
    if (user) {
      return { name: user.name.trim().slice(0, 50), userId: user.id, user };
    }
    // Fall through to email/name handling if the userId is stale.
  }

  // 2. Email that resolves to a registered User.
  if (normalizedEmail) {
    const user = await prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true, name: true },
    });
    if (user) {
      return { name: user.name.trim().slice(0, 50), userId: user.id, user };
    }
  }

  // 3. Name that uniquely matches a single User (fuzzy, case-insensitive).
  if (rawName) {
    const target = normalizeForMatch(rawName);
    if (target) {
      const allUsers = await prisma.user.findMany({ select: { id: true, name: true } });
      const matches = allUsers.filter((u) => normalizeForMatch(u.name) === target);
      if (matches.length === 1) {
        return { name: matches[0].name.trim().slice(0, 50), userId: matches[0].id, user: matches[0] };
      }
    }
  }

  // 4. Anonymous / no link.
  if (!rawName && normalizedEmail) {
    // Caller provided only an email for an unregistered user — use the
    // local-part as a display name fallback (the caller may have already
    // required a name; this keeps the function total).
    const local = normalizedEmail.split("@")[0] ?? normalizedEmail;
    return { name: local.slice(0, 50), userId: null, user: null };
  }

  if (!rawName) {
    throw new Error("Player name is required.");
  }

  return { name: rawName, userId: null, user: null };
}

/**
 * Ensure an EventPlayer row exists for (eventId, name) and is linked to
 * userId when applicable. Clears any stale invitationOptOutAt so a
 * re-join/re-invite is not blocked by a previous opt-out.
 */
export async function upsertEventPlayerForRoster(
  eventId: string,
  target: RosterTarget,
  client: Pick<typeof prisma, "eventPlayer"> = prisma,
): Promise<{ id: string; name: string; userId: string | null }> {
  // Account-linked identities are event-scoped, not name-scoped. Reuse an
  // existing identity even when the caller's display name has changed; this
  // prevents a self-join from creating a second EventPlayer for the same user.
  if (target.userId) {
    const existingByUser = await client.eventPlayer.findFirst({
      where: { eventId, userId: target.userId },
    });
    if (existingByUser) {
      return client.eventPlayer.update({
        where: { id: existingByUser.id },
        data: { invitationOptOutAt: null },
      });
    }
  }

  const ep = await client.eventPlayer.upsert({
    where: { eventId_name: { eventId, name: target.name } },
    create: { eventId, name: target.name, userId: target.userId },
    update: {
      ...(target.userId ? { userId: target.userId } : {}),
      invitationOptOutAt: null,
    },
  });
  return ep;
}

/**
 * Create or update the GameParticipant for (gameId, eventPlayerId) with
 * the desired status. Pending invites are visible as "Invited" but do not
 * count toward the active roster; active entries are the real roster.
 */
export async function upsertGameParticipantForRoster(
  opts: {
    gameId: string;
    eventPlayerId: string;
    status: "active" | "pending";
    order?: number;
  },
  client: Pick<typeof prisma, "gameParticipant"> = prisma,
): Promise<{ id: string; order: number; status: string }> {
  const order = opts.order ?? (await nextGameParticipantOrder(opts.gameId));
  const gp = await client.gameParticipant.upsert({
    where: { gameId_eventPlayerId: { gameId: opts.gameId, eventPlayerId: opts.eventPlayerId } },
    create: { gameId: opts.gameId, eventPlayerId: opts.eventPlayerId, order, status: opts.status },
    update: { order, status: opts.status, archivedAt: null },
  });
  return gp;
}
