import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { ApiError, apiRequest } from "~/lib/api/client";
import { useT } from "~/lib/useT";
import { addKnownName } from "~/lib/knownNames";
import type { EventData, Player } from "../types";
import type { MyRsvp } from "./useMyRsvp";
import { rosterErrorMessage } from "./rosterErrors";

/** The browser's stable id, sent so the server can tell two devices of one person apart. */
function clientId(): string {
  if (typeof localStorage === "undefined") return "";
  let id = localStorage.getItem("client_id");
  if (!id) { id = crypto.randomUUID(); localStorage.setItem("client_id", id); }
  return id;
}

export interface AddOptions {
  /** Link the new row to the viewer's own account (joining yourself). */
  linkToAccount: boolean;
  email?: string;
  position?: string;
}

export type AddOutcome =
  | { ok: true; resolvedName: string; anonymous: boolean }
  | { ok: false; reason: "busy" | "payment" | "failed"; message?: string };

export interface RosterActionsArgs {
  eventId: string;
  event: EventData;
  setEvent: Dispatch<SetStateAction<EventData | null>>;
  refetch: () => Promise<void>;
  /** Start a write: until it ends, a poll that lands must not overwrite what the viewer just did. */
  beginWrite: () => () => void;
  viewer: { id: string; name: string } | null;
  rsvp: MyRsvp;
  setRsvp: (next: MyRsvp) => void;
  notify: (message: string) => void;
}

/**
 * Everything the viewer can do to the roster, optimistic with a precise rollback: the row appears
 * (or goes) at once; if the server refuses, exactly that row is put back and a plain sentence says why.
 * One request at a time, so a double tap can never send two.
 */
export function useRosterActions(a: RosterActionsArgs) {
  const t = useT();
  const { eventId, event, setEvent, refetch, beginWrite, viewer, rsvp, setRsvp, notify } = a;
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A request that died on the network is retried with the SAME key, so the server counts it once.
  const retryKey = useRef<{ fingerprint: string; key: string } | null>(null);

  /** Run one request at a time. Returns null when another is already running. */
  const exclusive = useCallback(async <T,>(run: () => Promise<T>): Promise<T | null> => {
    if (busyRef.current) return null;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try { return await run(); } finally { busyRef.current = false; setBusy(false); }
  }, []);

  const addRow = useCallback(async (name: string, o: AddOptions): Promise<AddOutcome> => {
    const trimmed = name.trim().slice(0, 50);
    const fingerprint = JSON.stringify([trimmed, o.linkToAccount, o.email ?? "", o.position ?? ""]);
    const key = retryKey.current?.fingerprint === fingerprint ? retryKey.current.key : crypto.randomUUID();
    retryKey.current = { fingerprint, key };
    const end = beginWrite();
    const tempId = `temp-${key}`;
    if (trimmed) {
      const row: Player = { id: tempId, name: trimmed, userId: o.linkToAccount ? viewer?.id ?? null : null };
      setEvent((e) => (e ? { ...e, players: [...e.players, row] } : e));
    }
    try {
      const json = (await apiRequest("POST /api/events/{id}/players", {
        params: { id: eventId },
        body: { name: trimmed, linkToAccount: o.linkToAccount, ...(o.email ? { email: o.email.trim() } : {}), ...(o.position ? { position: o.position } : {}) },
        init: { headers: { "X-Client-Id": clientId(), "Idempotency-Key": key } },
      })) as { resolvedName?: string; anonymous?: boolean };
      retryKey.current = null;
      const resolvedName = json.resolvedName ?? trimmed;
      addKnownName(resolvedName);
      end();
      await refetch();
      return { ok: true, resolvedName, anonymous: json.anonymous === true };
    } catch (e) {
      setEvent((c) => (c ? { ...c, players: c.players.filter((p) => p.id !== tempId) } : c));
      end();
      if (e instanceof ApiError) {
        retryKey.current = null;
        void refetch();
        if (e.status === 402 && (e.payload as { code?: unknown } | undefined)?.code === "PAYMENT_GATE") return { ok: false, reason: "payment" };
      }
      return { ok: false, reason: "failed", message: rosterErrorMessage(e, t, { maxPlayers: event.maxPlayers, fallback: t("ngJoinError"), name: trimmed }) };
    }
  }, [beginWrite, event.maxPlayers, eventId, refetch, setEvent, t, viewer?.id]);

  /** Add a row. `null` when another request is still running. */
  const add = useCallback((name: string, o: AddOptions) => exclusive(() => addRow(name, o)), [addRow, exclusive]);

  /** The viewer joins themselves. "payment" asks the caller to show the payment dialog. */
  const join = useCallback(async (): Promise<"joined" | "payment" | "failed" | "busy"> => {
    if (!viewer) return "failed";
    const outcome = await add(viewer.name, { linkToAccount: true });
    if (!outcome) return "busy";
    if (outcome.ok) { setRsvp("yes"); notify(t("rsvpYesToast")); return "joined"; }
    if (outcome.reason === "payment") return "payment";
    setError(outcome.message ?? t("ngJoinError"));
    return "failed";
  }, [add, notify, setRsvp, t, viewer]);

  /** The viewer takes themselves off the list: goes through /leave, which also records "no". */
  const leave = useCallback(async (): Promise<boolean> => {
    const ran = await exclusive(async () => {
      if (!viewer) return false;
      const index = event.players.findIndex((p) => p.userId === viewer.id);
      if (index < 0) return false;
      const row = event.players[index];
      const previous = rsvp;
      const end = beginWrite();
      setEvent((e) => (e ? { ...e, players: e.players.filter((p) => p.id !== row.id) } : e));
      setRsvp("no");
      try {
        await apiRequest("POST /api/events/{id}/leave", { params: { id: eventId }, init: { credentials: "include" } });
        end();
        notify(t("rsvpNoToast"));
        await refetch();
        return true;
      } catch {
        setEvent((e) => {
          if (!e || e.players.some((p) => p.id === row.id)) return e;
          const players = [...e.players];
          players.splice(Math.min(index, players.length), 0, row);
          return { ...e, players };
        });
        setRsvp(previous);
        end();
        setError(t("ngRsvpError"));
        void refetch();
        return false;
      }
    });
    return ran === true;
  }, [beginWrite, event.players, eventId, exclusive, notify, refetch, rsvp, setEvent, setRsvp, t, viewer]);

  /** "Can't make it" from the choose row: the viewer is not on the list, so only the answer is recorded. */
  const decline = useCallback(async (): Promise<boolean> => {
    const ran = await exclusive(async () => {
      const previous = rsvp;
      setRsvp("no");
      try {
        await apiRequest("POST /api/events/{id}/rsvp", {
          params: { id: eventId }, body: { status: "no" },
          init: { credentials: "include", headers: { "Idempotency-Key": crypto.randomUUID() } },
        });
        notify(t("rsvpNoToast"));
        return true;
      } catch {
        setRsvp(previous);
        setError(t("ngRsvpError"));
        return false;
      }
    });
    return ran === true;
  }, [eventId, exclusive, notify, rsvp, setRsvp, t]);

  return { busy, error, clearError: useCallback(() => setError(null), []), setError, add, join, leave, decline };
}
