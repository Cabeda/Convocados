/**
 * Pending cross-account merge capture (ADR 0040).
 *
 * When a Google link OAuth callback finds Account(issuer, accountId) already
 * owned by a different User, better-auth redirects with
 * `account_already_linked_to_different_user` and discards the tokens. We need
 * the sub + absorbed userId to offer the interstitial confirm.
 *
 * During the callback we know the survivor (state.link.userId) before
 * better-auth calls findAccountByKey. AsyncLocalStorage scopes the note to
 * that one request; a module-level map holds the pending merge until the
 * survivor confirms (POST /api/me/credentials/merge) or it expires.
 */
import { AsyncLocalStorage } from "node:async_hooks";

export interface AccountKeyInput {
  providerId: string;
  accountId: string;
  issuer?: string | null;
}

export interface AccountLookupResult {
  id: string;
  userId: string;
  providerId: string;
  accountId: string;
  issuer?: string | null;
}

export interface PendingMerge {
  survivorUserId: string;
  absorbedUserId: string;
  accountRowId: string;
  providerId: string;
  accountId: string;
  issuer: string | null;
  expiresAt: number;
}

const PENDING_TTL_MS = 15 * 60_000;

const storage = new AsyncLocalStorage<{ survivorUserId: string }>();
const pendingBySurvivor = new Map<string, PendingMerge>();

/** Run fn with merge-capture active for the given survivor (link OAuth callback). */
export function captureDuring<T>(survivorUserId: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ survivorUserId }, fn);
}

/**
 * Called (via internalAdapter wrap) whenever better-auth resolves an account
 * key. Stashes a pending merge only inside a link capture context and only
 * when the account belongs to someone else.
 */
export function noteAccountLookup(_key: AccountKeyInput, account: AccountLookupResult | null | undefined): void {
  if (!account) return;
  const ctx = storage.getStore();
  if (!ctx) return;
  if (account.userId === ctx.survivorUserId) return;

  pendingBySurvivor.set(ctx.survivorUserId, {
    survivorUserId: ctx.survivorUserId,
    absorbedUserId: account.userId,
    accountRowId: account.id,
    providerId: account.providerId,
    accountId: account.accountId,
    issuer: account.issuer ?? null,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });
}

/** Pending merge for a survivor, or null if missing/expired. */
export function getPendingMerge(survivorUserId: string): PendingMerge | null {
  const entry = pendingBySurvivor.get(survivorUserId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    pendingBySurvivor.delete(survivorUserId);
    return null;
  }
  return entry;
}

export function clearPendingMerge(survivorUserId: string): void {
  pendingBySurvivor.delete(survivorUserId);
}

/** Test helper — wipe all pending merges. */
export function clearPendingMerges(): void {
  pendingBySurvivor.clear();
}

let _captureInstalled = false;

/**
 * Wrap internalAdapter.findAccountByKey once so conflict lookups during a
 * link callback are visible to noteAccountLookup. Safe to call repeatedly.
 */
export async function installMergeCapture(auth: { $context: Promise<unknown> }): Promise<void> {
  if (_captureInstalled) return;
  _captureInstalled = true;
  try {
    const ctx = (await auth.$context) as {
      internalAdapter: {
        findAccountByKey: (key: {
          providerId: string;
          accountId: string;
          issuer?: string | null;
        }) => Promise<AccountLookupResult | null>;
      };
    };
    const original = ctx.internalAdapter.findAccountByKey.bind(ctx.internalAdapter);
    ctx.internalAdapter.findAccountByKey = async (key) => {
      const result = await original(key);
      noteAccountLookup(key, result);
      return result;
    };
  } catch (err) {
    _captureInstalled = false;
    console.error("[merge-capture] install failed", err);
  }
}

/** Test-only: allow re-install after module reset. */
export function resetMergeCaptureForTests(): void {
  _captureInstalled = false;
}
