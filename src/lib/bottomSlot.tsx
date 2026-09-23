import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

/**
 * Single-owner arbitration for the app's bottom-of-viewport banners.
 *
 * `InstallBanner` (ResponsiveLayout) and `UpdateBanner` (ResponsiveLayout) are
 * fixed to the bottom edge, while `PushPromptBanner` is rendered inline by the
 * Dashboard and Event pages. Nothing stopped all three showing at once, so a
 * user could face a stack of competing prompts.
 *
 * Each banner claims the slot with `useBottomSlotClaim(id, wants)` and only
 * renders while it holds the grant. Priority is fixed:
 * update > install > push — an app update is the most urgent, an install pitch
 * the least. Rendered with no provider (standalone component tests) every
 * claim is granted, so banners keep working in isolation.
 */

export type BottomBannerId = "update" | "install" | "push";

export const BOTTOM_BANNER_PRIORITY: readonly BottomBannerId[] = ["update", "install", "push"];

/** Highest-priority banner with an active claim, or null when the slot is free. */
export function pickBottomBanner(
  wants: Partial<Record<BottomBannerId, boolean>>,
): BottomBannerId | null {
  for (const id of BOTTOM_BANNER_PRIORITY) {
    if (wants[id]) return id;
  }
  return null;
}

type Claims = Partial<Record<BottomBannerId, boolean>>;

interface BottomSlotContextValue {
  winner: BottomBannerId | null;
  claim: (id: BottomBannerId, wants: boolean) => void;
}

const BottomSlotContext = createContext<BottomSlotContextValue | null>(null);

export function BottomSlotProvider({ children }: { children: React.ReactNode }) {
  const [claims, setClaims] = useState<Claims>({});

  const claim = useCallback((id: BottomBannerId, wants: boolean) => {
    setClaims((prev) => (prev[id] === wants ? prev : { ...prev, [id]: wants }));
  }, []);

  const winner = useMemo(() => pickBottomBanner(claims), [claims]);
  const value = useMemo(() => ({ winner, claim }), [winner, claim]);

  return <BottomSlotContext.Provider value={value}>{children}</BottomSlotContext.Provider>;
}

/**
 * Register this banner's demand for the slot.
 *
 * Returns true while the banner holds the grant (or when no provider is
 * present). Claims are cleared automatically on unmount.
 */
export function useBottomSlotClaim(id: BottomBannerId, wants: boolean): boolean {
  const ctx = useContext(BottomSlotContext);

  useEffect(() => {
    if (!ctx) return;
    ctx.claim(id, wants);
    return () => ctx.claim(id, false);
  }, [ctx, id, wants]);

  if (!ctx) return true;
  return ctx.winner === id;
}
