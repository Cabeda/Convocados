import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from "react";
import { apiRequest } from "~/lib/api/client";
import { useT } from "~/lib/useT";
import { canUndoRemoval } from "~/lib/nextGame";
import type { EventPermissions } from "~/lib/eventView";
import type { EventData, Player } from "../types";

/** How long the server takes an undo (UNDO_WINDOW_MS in undo-remove.ts). */
export const UNDO_WINDOW_MS = 60_000;

export interface UndoState {
  name: string;
  order: number;
  userId: string | null;
  removedAt: number;
}

interface Args {
  eventId: string;
  players: readonly Player[];
  setEvent: Dispatch<SetStateAction<EventData | null>>;
  refetch: () => Promise<void>;
  beginWrite: () => () => void;
  perms: Pick<EventPermissions, "isOwner" | "isAdmin" | "canEditSettings">;
  notify: (message: string) => void;
}

function clientId(): string {
  return typeof localStorage === "undefined" ? "" : localStorage.getItem("client_id") ?? "";
}

/**
 * Removing a player from the list, optimistic with a precise rollback, and the 60-second Undo.
 * Undo is offered only to someone the server will take it from: the removal route lets a player
 * take themselves off and anyone take off an anonymous row, but the undo route is organizer-only.
 */
export function useRosterRemoval({ eventId, players, setEvent, refetch, beginWrite, perms, notify }: Args) {
  const t = useT();
  const [undo, setUndo] = useState<UndoState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canUndo = canUndoRemoval(perms);

  const remove = useCallback(async (player: Player): Promise<boolean> => {
    if (busy) return false;
    setBusy(true);
    setError(null);
    const index = players.findIndex((p) => p.id === player.id);
    const end = beginWrite();
    setEvent((e) => (e ? { ...e, players: e.players.filter((p) => p.id !== player.id) } : e));
    try {
      const data = (await apiRequest("DELETE /api/events/{id}/players", {
        params: { id: eventId }, body: { playerId: player.id }, init: { headers: { "X-Client-Id": clientId() } },
      })) as { undo?: UndoState };
      end();
      if (data.undo && canUndo) setUndo(data.undo); else setUndo(null);
      await refetch();
      return true;
    } catch {
      setEvent((e) => {
        if (!e || e.players.some((p) => p.id === player.id)) return e;
        const players = [...e.players];
        players.splice(Math.min(Math.max(index, 0), players.length), 0, player);
        return { ...e, players };
      });
      end();
      setError(t("ngRemoveError", { name: player.name }));
      void refetch();
      return false;
    } finally {
      setBusy(false);
    }
  }, [beginWrite, busy, canUndo, players, eventId, refetch, setEvent, t]);

  const dismissUndo = useCallback(() => setUndo(null), []);

  const runUndo = useCallback(async () => {
    if (!undo) return;
    const pending = undo;
    setUndo(null);
    const end = beginWrite();
    try {
      await apiRequest("POST /api/events/{id}/undo-remove", { params: { id: eventId }, body: pending });
      end();
      notify(t("ngRestored", { name: pending.name }));
    } catch {
      end();
      setError(t("ngUndoError", { name: pending.name }));
    }
    await refetch();
  }, [beginWrite, eventId, notify, refetch, t, undo]);

  // The undo window closes: one timeout, not a ticker.
  useEffect(() => {
    if (!undo) return;
    const id = setTimeout(() => setUndo(null), UNDO_WINDOW_MS);
    return () => clearTimeout(id);
  }, [undo]);

  return { remove, undo, runUndo, dismissUndo, error, clearError: useCallback(() => setError(null), []), busy };
}
