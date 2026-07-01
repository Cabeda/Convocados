/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, user interactions mutate it, server data resyncs on refetch. Setting from async fetch callbacks is also fine. */
import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Container, Paper, Typography, Box, Stack, Button, IconButton, Tooltip,
  Alert, Skeleton,
} from "@mui/material";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import ShuffleIcon from "@mui/icons-material/Shuffle";
import ShareIcon from "@mui/icons-material/Share";
import PaymentsIcon from "@mui/icons-material/Payments";
import SettingsIcon from "@mui/icons-material/Settings";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { TeamPicker } from "./TeamPicker";
import { PaymentSection } from "./PaymentSection";
import type { Imatch } from "~/lib/random";
import { useT } from "~/lib/useT";
import { detectLocale } from "~/lib/i18n";
import { addKnownName, getQjName } from "~/lib/knownNames";
import { formatDateInTz, fromDateTimeLocalValue } from "~/lib/timezones";
import { useSession } from "~/lib/auth.client";
import type { RsvpStatus } from "~/lib/rsvp";

import {
  EventHeader,
  PlayerList,
  PaymentNudgeDialog,
  EventDialogs,
  PasswordPrompt,
  useCountdown,
  AddPlayerConfirmDialog,
  type AddPlayerIntent,
} from "./event";
import type { EventData, Player, KnownPlayer } from "./event";
import { PostGameBanner } from "./PostGameBanner";
import type { PostGameStatus } from "./PostGameBanner";
import { PushPromptBanner } from "./PushPromptBanner";
import { AttendanceCta } from "./event/AttendanceCta";


// ── Main component ────────────────────────────────────────────────────────────

// #463 high-intent: pending RSVP + event kicking off within 48h.
// Render the push prompt as a centered modal so it's harder to ignore.
const PUSH_PROMPT_HIGH_INTENT_HOURS = 48;
function isHighIntentForPush(
  eventDateTime: string | Date,
  myRsvpStatus: string | null,
): boolean {
  if (myRsvpStatus !== null) return false; // user has answered — no need to nag
  const date = typeof eventDateTime === "string" ? new Date(eventDateTime) : eventDateTime;
  const hoursUntil = (date.getTime() - Date.now()) / (60 * 60 * 1000);
  return hoursUntil > 0 && hoursUntil <= PUSH_PROMPT_HIGH_INTENT_HOURS;
}

export default function EventPage({ eventId }: { eventId: string }) {
  const t = useT();
  const locale = detectLocale();
  const { data: session } = useSession();

  // ADR 0018: Detect ?action= from notification deep links
  const [deepLinkAction] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("action");
  });
  const [deepLinkPlayer] = useState(() => {
    if (typeof window === "undefined") return null;
    const params = new URLSearchParams(window.location.search);
    return params.get("player");
  });
  // ponytail: backward compat — autoOpenPay still works for existing links
  const autoOpenPay = deepLinkAction === "pay";

  // ── UI state ────────────────────────────────────────────────────────────────
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [balanced, setBalanced] = useState(false);
  const [_isPublic, setIsPublic] = useState(false);
  const [sport, setSport] = useState("football-5v5");
  const [relinquishConfirmOpen, setRelinquishConfirmOpen] = useState(false);
  const [_postGameStatus, setPostGameStatus] = useState<PostGameStatus | null>(null);
  const [paymentExpanded, setPaymentExpanded] = useState<boolean | undefined>(undefined);
  const [bannerRefreshKey, setBannerRefreshKey] = useState(0);

  // ── ELO ratings for balanced mode ───────────────────────────────────────────
  const [ratingsResponse, setRatingsResponse] = useState<{ data: { name: string; rating: number }[] } | null>(null);
  useEffect(() => {
    if (!balanced) { setRatingsResponse(null); return; }
    const controller = new AbortController();
    fetch(`/api/events/${eventId}/ratings?limit=100`, { signal: controller.signal })
      .then((r) => r.json())
      .then(setRatingsResponse)
      .catch(() => {});
    return () => controller.abort();
  }, [balanced, eventId]);
  const ratingsMap = useMemo(() => {
    if (!ratingsResponse?.data) return undefined;
    const map: Record<string, number> = {};
    for (const r of ratingsResponse.data) map[r.name] = r.rating;
    return map;
  }, [ratingsResponse]);

  // ── Stable client ID ────────────────────────────────────────────────────────
  const clientIdRef = useRef<string>("");
  useEffect(() => {
    if (typeof localStorage === "undefined") return;
    let id = localStorage.getItem("client_id");
    if (!id) { id = crypto.randomUUID(); localStorage.setItem("client_id", id); }
    clientIdRef.current = id;
  }, []);

  // ── Team state ──────────────────────────────────────────────────────────────
  const [localMatches, setLocalMatches] = useState<Imatch[] | null>(null);
  const [teamOneName, setTeamOneName] = useState("");
  const [teamTwoName, setTeamTwoName] = useState("");

  // ── Event data ──────────────────────────────────────────────────────────────
  const [event, setEvent] = useState<EventData | null>(null);
  const [error, setError] = useState<{ status?: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lockedEvent, setLockedEvent] = useState<{ id: string; title: string } | null>(null);

  const fetchEvent = useCallback(async () => {
    try {
      const r = await fetch(`/api/events/${eventId}`);
      if (r.status === 404) { setError({ status: 404 }); return; }
      const data = await r.json();
      if (data.locked) {
        setLockedEvent({ id: data.id, title: data.title });
        setEvent(null);
      } else {
        setEvent(data);
        setLockedEvent(null);
        setError(null);
      }
    } catch (_e) {
      setError({});
    } finally {
      setIsLoading(false);
    }
  }, [eventId]);

  // Initial fetch
  useEffect(() => { fetchEvent(); }, [fetchEvent]);

  // Poll for updates every 10s
  useEffect(() => {
    const id = setInterval(fetchEvent, 10_000);
    return () => clearInterval(id);
  }, [fetchEvent]);

  // Re-fetch on window focus
  useEffect(() => {
    const onFocus = () => fetchEvent();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchEvent]);

  // ── Known players for autocomplete ──────────────────────────────────────────
  const [knownPlayersData, setKnownPlayersData] = useState<{ players: KnownPlayer[] } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/events/${eventId}/known-players`, { signal: controller.signal })
      .then((r) => r.json())
      .then(setKnownPlayersData)
      .catch(() => {});
    return () => controller.abort();
  }, [eventId]);

  // ── Payment-nudge state ────────────────────────────────────────────────────
  // Fetched lazily on first pill click; controls whether the Quick Join pill
  // routes through the payment-nudge dialog (when the user has a balance) or
  // joins directly. The dialog also re-fetches its own copy of the balance.
  const [paymentNudgeOpen, setPaymentNudgeOpen] = useState(false);
  const [cachedBalance, setCachedBalance] = useState<{ hasDebt: boolean; enforcement: string } | null>(null);
  const refreshBalance = useCallback(async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/balance`);
      if (!r.ok) return;
      const j = await r.json();
      const amt = j?.callerBalance?.amount ?? 0;
      setCachedBalance({ hasDebt: amt > 0, enforcement: j?.enforcement ?? "off" });
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => {
    if (autoOpenPay) {
      refreshBalance();
      setPaymentNudgeOpen(true);
    }
    // ADR 0018: Handle other deep link actions (runs after first render when event data is ready)
    if (deepLinkAction === "add-score") {
      window.location.href = `/events/${eventId}/history`;
    }
    if (deepLinkAction === "rsvp") {
      setTimeout(() => {
        document.querySelector("[data-player-list]")?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
    if (deepLinkAction === "confirm-payment" && deepLinkPlayer) {
      setPaymentExpanded(true);
      setTimeout(() => {
        document.getElementById("payment-section")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 300);
    }
  }, [autoOpenPay, deepLinkAction, deepLinkPlayer, refreshBalance, eventId]);

  const mergedSuggestions = useMemo(() => {
    const qjName = getQjName().trim();
    return (knownPlayersData?.players ?? [])
      .map((p) => ({
        name: p.name,
        gamesPlayed: p.gamesPlayed ?? 1,
        userId: p.userId ?? null,
      }))
      .sort((a, b) => {
        if (qjName && a.name.toLowerCase() === qjName.toLowerCase()) return -1;
        if (qjName && b.name.toLowerCase() === qjName.toLowerCase()) return 1;
        return b.gamesPlayed - a.gamesPlayed;
      });
  }, [knownPlayersData]);

  const currentPlayerNames = useMemo(
    () => new Set((event?.players ?? []).map((p) => p.name.toLowerCase())),
    [event?.players]
  );

  const availableSuggestions = useMemo(
    () => mergedSuggestions.filter((s) => !currentPlayerNames.has(s.name.toLowerCase())),
    [mergedSuggestions, currentPlayerNames]
  );

  const notFound = error?.status === 404;

  useEffect(() => {
    if (event) document.title = `${event.title} — Convocados`;
    return () => { document.title = "Convocados"; };
  }, [event]);

  // ── Sync localMatches from server ───────────────────────────────────────────
  const isDraggingRef = useRef(false);
  useEffect(() => {
    if (!event || isDraggingRef.current) return;
    if (event.teamResults.length > 0) {
      setLocalMatches(event.teamResults.map((tr) => ({
        team: tr.name,
        players: tr.members.map((m) => ({ name: m.name, order: m.order })),
      })));
    } else {
      setLocalMatches(null);
    }
    setTeamOneName(event.teamOneName);
    setTeamTwoName(event.teamTwoName);
    setIsPublic(event.isPublic);
    setBalanced(event.balanced);
    setSport(event.sport);
  }, [event]);

  // ── Player CRUD ─────────────────────────────────────────────────────────────

  // In-flight guard: a single addPlayer call is allowed at a time.
  // Subsequent calls (from a different chip, dropdown row, or confirm button)
  // return early and surface an "in flight" snackbar.
  const addInFlightRef = useRef<{ name: string; idempotencyKey: string } | null>(null);
  const [addInFlightName, setAddInFlightName] = useState<string | null>(null);

  // Confirmation dialog state. Lifted to EventPage so the dialog content
  // (bench/email footnotes) can read the same event state that addPlayer uses.
  const [addIntent, setAddIntent] = useState<AddPlayerIntent | null>(null);

  const performAdd = async (
    name: string,
    linkToAccount: boolean,
    email: string | undefined,
    idempotencyKey: string,
  ) => {
    if (addInFlightRef.current) {
      setSnackbar(t("addPlayerInFlight", { name: addInFlightRef.current.name }));
      return;
    }
    if (!name.trim() && !email?.trim()) return;
    setPlayerError(null);
    const trimmed = name.trim().slice(0, 50);

    addInFlightRef.current = { name: trimmed || email!, idempotencyKey };
    setAddInFlightName(trimmed || email!);

    // Optimistic update (only if we have a name to show)
    if (trimmed) {
      setEvent((current) => {
        if (!current) return current;
        const optimisticPlayer: Player = { id: `temp-${Date.now()}`, name: trimmed, userId: null };
        return { ...current, players: [...current.players, optimisticPlayer] };
      });
    }

    try {
      const res = await fetch(`/api/events/${eventId}/players`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Client-Id": clientIdRef.current,
          "Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({ name: trimmed, linkToAccount, ...(email ? { email: email.trim() } : {}) }),
      });
      const json = await res.json();
      if (!res.ok) {
        setPlayerError(json.error);
        fetchEvent(); // revert optimistic update
        return;
      }
      const resolvedName: string | undefined = json.resolvedName;
      if (resolvedName && resolvedName !== trimmed && trimmed) {
        setSnackbar(`Added ${resolvedName} ✓`);
      }
      addKnownName(resolvedName ?? trimmed);
      fetchEvent();
    } finally {
      addInFlightRef.current = null;
      setAddInFlightName(null);
    }
  };

  /**
   * Direct add: bypasses the confirmation dialog. Used by Quick Join
   * (self-initiated) and by the Enter/IconButton paths in PlayerList
   * (typing is itself a deliberate action).
   */
  const addPlayer = async (name: string, linkToAccount = false, email?: string) => {
    const idempotencyKey = crypto.randomUUID();
    await performAdd(name, linkToAccount, email, idempotencyKey);
  };

  /**
   * Request an add that should be confirmed. Opens the dialog; the actual
   * add is dispatched from the dialog's confirm handler. Used by chip and
   * dropdown paths in PlayerList / PlayerAutocomplete (single-tap surfaces).
   */
  const requestAddPlayer = (intent: AddPlayerIntent) => {
    if (addInFlightRef.current) {
      setSnackbar(t("addPlayerInFlight", { name: addInFlightRef.current.name }));
      return;
    }
    setAddIntent(intent);
  };

  const handleConfirmAdd = async (intent: AddPlayerIntent) => {
    const idempotencyKey = crypto.randomUUID();
    const confirmedName = intent.name;
    setAddIntent(null);
    await performAdd(intent.name, false, intent.email, idempotencyKey);
    // If performAdd did nothing because of the in-flight guard, the snackbar
    // already informed the user. Otherwise, use the resolved name from
    // performAdd for the snackbar (the snackbar is set inside performAdd).
    void confirmedName;
  };

  // Routes the Quick Join pill click: opens the payment-nudge dialog when the user
  // has a balance, otherwise joins directly. Server PAYMENT_GATE 402 falls back to the dialog.
  const handleQuickJoinPillClick = (name: string) => {
    const openDialog = () => setPaymentNudgeOpen(true);
    if (cachedBalance) {
      if (cachedBalance.hasDebt && cachedBalance.enforcement !== "off") {
        openDialog();
      } else {
        addPlayer(name, true).catch((err: unknown) => {
          if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "PAYMENT_GATE") {
            openDialog();
          } else {
            throw err;
          }
        });
      }
      return;
    }
    // No cached balance yet — fetch, then decide.
    fetch(`/api/events/${eventId}/balance`)
      .then((r) => r.json())
      .then((j: { callerBalance?: { amount?: number }; enforcement?: string }) => {
        const amt = j?.callerBalance?.amount ?? 0;
        const enforcement = j?.enforcement ?? "off";
        setCachedBalance({ hasDebt: amt > 0, enforcement });
        if (amt > 0 && enforcement !== "off") {
          openDialog();
        } else {
          return addPlayer(name, true);
        }
      })
      .catch(() => { /* swallow — player can retry */ });
  };

  // ADR 0018: Auto-join deep link (needs handleQuickJoinPillClick to be defined)
  useEffect(() => {
    if (deepLinkAction === "join" && session?.user?.name) {
      setTimeout(() => handleQuickJoinPillClick(session.user!.name), 500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkAction, session?.user?.name]);

  const removePlayer = async (playerId: string) => {
    // Optimistic update
    setEvent((current) => {
      if (!current) return current;
      return { ...current, players: current.players.filter((p) => p.id !== playerId) };
    });

    const res = await fetch(`/api/events/${eventId}/players`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json", "X-Client-Id": clientIdRef.current },
      body: JSON.stringify({ playerId }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.undo) {
        setUndoData({ eventId, ...data.undo });
      }
    } else {
      fetchEvent();
      return;
    }
    fetchEvent();
  };

  // ── Undo remove ─────────────────────────────────────────────────────────────
  const [undoData, setUndoData] = useState<{ eventId: string; name: string; order: number; userId: string | null; removedAt: number } | null>(null);

  const handleUndo = useCallback(async () => {
    if (!undoData) return;
    const res = await fetch(`/api/events/${undoData.eventId}/undo-remove`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(undoData),
    });
    if (res.ok) {
      fetchEvent();
    } else {
      const json = await res.json();
      setPlayerError(json.error);
    }
    setUndoData(null);
  }, [undoData, fetchEvent]);

  useEffect(() => {
    if (!undoData) return;
    const timer = setTimeout(() => setUndoData(null), 60_000);
    return () => clearTimeout(timer);
  }, [undoData]);

  // ── Player reorder ──────────────────────────────────────────────────────────

  const reorderPlayers = useCallback(async (reorderedIds: string[]) => {
    await fetch(`/api/events/${eventId}/reorder-players`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ playerIds: reorderedIds }),
    });
    fetchEvent();
  }, [eventId, fetchEvent]);

  const resetPlayerOrder = useCallback(async () => {
    const res = await fetch(`/api/events/${eventId}/reset-player-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) fetchEvent();
  }, [eventId, fetchEvent]);

  // ── Team operations ─────────────────────────────────────────────────────────

  const doRandomize = async () => {
    setConfirmOpen(false);
    const qs = balanced ? "?balanced=true" : "";
    const res = await fetch(`/api/events/${eventId}/randomize${qs}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    const json = await res.json();
    if (!res.ok) { setPlayerError(json.error); return; }
    fetchEvent();
  };

  const handleTeamChange = async (matches: Imatch[]) => {
    setLocalMatches(matches);
    isDraggingRef.current = true;
    const res = await fetch(`/api/events/${eventId}/teams`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ matches }),
    });
    isDraggingRef.current = false;
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      setSnackbar(json.error || "Failed to update teams");
    }
    fetchEvent();
  };

  const handleTeamNameSave = async (one: string, two: string) => {
    await fetch(`/api/events/${eventId}/team-names`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ teamOneName: one, teamTwoName: two }),
    });
    fetchEvent();
  };

  // ── Title & location save ───────────────────────────────────────────────────

  const handleSaveTitle = async (title: string) => {
    // Optimistic update
    setEvent((e) => e ? { ...e, title } : e);
    const res = await fetch(`/api/events/${eventId}/title`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) fetchEvent(); // revert on error
    else fetchEvent();
  };

  const handleSaveLocation = async (location: string) => {
    const res = await fetch(`/api/events/${eventId}/location`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ location }),
    });
    const data = await res.json();
    if (location && !data.geocoded) {
      setSnackbar(t("locationNotGeocoded"));
    }
    fetchEvent();
  };

  const handleSaveDateTime = async (dateTime: string, timezone: string) => {
    // Convert the datetime-local value (in the event's timezone) to a UTC ISO string
    const utcIso = fromDateTimeLocalValue(dateTime, timezone);
    await fetch(`/api/events/${eventId}/datetime`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dateTime: utcIso, timezone }),
    });
    fetchEvent();
  };

  const handleSaveSport = async (sport: string) => {
    await fetch(`/api/events/${eventId}/sport`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sport }),
    });
    fetchEvent();
  };

  // ── Ownership ───────────────────────────────────────────────────────────────

  const handleClaimOwnership = async () => {
    const res = await fetch(`/api/events/${eventId}/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
    if (res.ok) {
      fetchEvent();
      setSnackbar(t("claimOwnership"));
    }
  };

  const handleRelinquishOwnership = async () => {
    setRelinquishConfirmOpen(false);
    const res = await fetch(`/api/events/${eventId}/claim`, { method: "DELETE" });
    if (res.ok) fetchEvent();
  };

  // ── Derived state ───────────────────────────────────────────────────────────

  const gameDate = useMemo(() => event ? new Date(event.dateTime) : new Date(), [event]);
  const countdown = useCountdown(gameDate, t("gameTime"));

  const isAuthenticated = !!session?.user;
  const isOwner = !!(session?.user && event?.ownerId && session.user.id === event.ownerId);
  const isOwnerless = !event?.ownerId;
  const isAdmin = !!event?.isAdmin;
  const canEditSettings = isOwnerless || isOwner || isAdmin;

  // #463 high-intent: fetch the signed-in user's RSVP for this event so the
  // PushPromptBanner can render as a modal when the user has a pending RSVP
  // and the game kicks off within 48h.
  const [myRsvpStatus, setMyRsvpStatus] = useState<"yes" | "no" | "maybe" | null>(null);
  useEffect(() => {
    if (!isAuthenticated || !eventId) {
      setMyRsvpStatus(null);
      return;
    }
    let alive = true;
    fetch(`/api/events/${eventId}/rsvp`, { credentials: "include" })
      .then(async (r) => {
        if (!alive) return;
        if (!r.ok) { setMyRsvpStatus(null); return; }
        const data = await r.json();
        setMyRsvpStatus((data.status ?? null) as "yes" | "no" | "maybe" | null);
      })
      .catch(() => alive && setMyRsvpStatus(null));
    return () => { alive = false; };
  }, [eventId, isAuthenticated]);

  // #XXX Guest attendance — fetched for the player-list pills (visible to all, clickable to owner/admin).
  const [guestRsvpMap, setGuestRsvpMap] = useState<Record<string, "yes" | "no" | "maybe" | null>>({});
  const fetchGuestRsvpMap = useCallback(async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/rsvp/guests`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      setGuestRsvpMap(data.guests ?? {});
    } catch { /* ignore */ }
  }, [eventId]);
  useEffect(() => { fetchGuestRsvpMap(); }, [fetchGuestRsvpMap]);

  // #XXX User attendance — fetched for the player-list pills on linked-user rows.
  // The server returns an empty map for anonymous viewers (one-way privacy), so this
  // is also implicitly the visibility gate: the PlayerList only renders the pill
  // when the current viewer is logged in.
  const [userRsvpMap, setUserRsvpMap] = useState<Record<string, "yes" | "no" | "maybe" | null>>({});
  const fetchUserRsvpMap = useCallback(async () => {
    try {
      const r = await fetch(`/api/events/${eventId}/rsvp/users`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      setUserRsvpMap(data.users ?? {});
    } catch { /* ignore */ }
  }, [eventId]);
  useEffect(() => { fetchUserRsvpMap(); }, [fetchUserRsvpMap]);

  const handleSetMyRsvp = useCallback(async (status: "yes" | "no") => {
    const prev = myRsvpStatus;
    setMyRsvpStatus(status); // optimistic
    try {
      // #XXX "no" goes through the leave endpoint: it sets Rsvp="no" AND archives the player.
      // "yes" stays on the plain rsvp endpoint (user stays on the player list).
      const url = status === "no"
        ? `/api/events/${eventId}/leave`
        : `/api/events/${eventId}/rsvp`;
      const r = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!r.ok) {
        setMyRsvpStatus(prev);
        const j = await r.json().catch(() => ({}));
        setSnackbar(j.error ?? t("somethingWentWrong"));
        return;
      }
      setSnackbar(status === "yes" ? t("rsvpYesToast") : t("rsvpNoToast"));
      // Refetch event so the archived player disappears from the list.
      fetchEvent();
    } catch {
      setMyRsvpStatus(prev);
      setSnackbar(t("somethingWentWrong"));
    }
  }, [eventId, myRsvpStatus, t, fetchEvent]);

  const handleSetGuestRsvp = useCallback(async (playerId: string, status: RsvpStatus) => {
    const prev = guestRsvpMap[playerId] ?? null;
    setGuestRsvpMap((m) => ({ ...m, [playerId]: status })); // optimistic
    try {
      const r = await fetch(`/api/events/${eventId}/players/${playerId}/rsvp`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ status }),
      });
      if (!r.ok) {
        setGuestRsvpMap((m) => ({ ...m, [playerId]: prev }));
        const j = await r.json().catch(() => ({}));
        setSnackbar(j.error ?? t("somethingWentWrong"));
        return;
      }
      // Refresh summary chips (used by AttendanceCard)
      fetchEvent();
    } catch {
      setGuestRsvpMap((m) => ({ ...m, [playerId]: prev }));
      setSnackbar(t("somethingWentWrong"));
    }
  }, [eventId, guestRsvpMap, fetchEvent, t]);

  const canRemovePlayer = (player: Player) => {
    if (isOwner || isAdmin) return true;
    if (session?.user && player.userId === session.user.id) return true;
    if (!player.userId) return true;
    return false;
  };

  // ── Loading / locked / not found states ─────────────────────────────────────

  if (isLoading) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>
            <Paper elevation={2} sx={{ borderRadius: 3, overflow: "hidden" }}>
              <Skeleton variant="rectangular" height={3} />
              <Box sx={{ p: { xs: 2, sm: 3 } }}>
                <Stack spacing={2}>
                  <Skeleton variant="text" width="60%" height={36} />
                  <Skeleton variant="text" width="30%" height={20} />
                  <Skeleton variant="rectangular" height={32} width={120} sx={{ borderRadius: 2 }} />
                  <Skeleton variant="rectangular" height={6} sx={{ borderRadius: 1 }} />
                  <Stack spacing={0.75}>
                    <Skeleton variant="text" width="45%" height={20} />
                    <Skeleton variant="text" width="35%" height={20} />
                  </Stack>
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <Skeleton variant="rounded" width={60} height={24} />
                    <Skeleton variant="rounded" width={80} height={24} />
                  </Box>
                  <Skeleton variant="rectangular" height={1} />
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <Skeleton variant="circular" width={40} height={40} />
                    <Skeleton variant="circular" width={40} height={40} />
                  </Box>
                </Stack>
              </Box>
            </Paper>
            <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
              <Skeleton variant="text" width="40%" height={28} sx={{ mb: 2 }} />
              <Stack spacing={1}>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} variant="rectangular" height={48} sx={{ borderRadius: 1 }} />
                ))}
              </Stack>
            </Paper>
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  if (lockedEvent) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <PasswordPrompt eventId={lockedEvent.id} title={lockedEvent.title} onUnlocked={fetchEvent} />
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  if (notFound || !event) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
          <Typography variant="h4" fontWeight={700} gutterBottom>{t("gameNotFound")}</Typography>
          <Typography color="text.secondary" gutterBottom>{t("gameNotFoundDesc")}</Typography>
          <Button variant="contained" href="/" sx={{ mt: 2 }}>{t("createNewGame")}</Button>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  const wasReset = event.wasReset ?? false;

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>

            {wasReset && (
              <Alert severity="info" icon={<EventRepeatIcon />}>
                {t("recurringResetAlert", {
                  date: formatDateInTz(gameDate, locale === "pt" ? "pt-PT" : "en-GB", event.timezone, {
                    weekday: "long", month: "long", day: "numeric",
                  }),
                })}
              </Alert>
            )}

            {/* #457 Push prompt banner — event-detail trigger. #463 high-intent:
                render as a centered modal when the user has a pending RSVP and
                the event kicks off within 48h. */}
            <PushPromptBanner
              followCount={0}
              forceOnEventDetail={isAuthenticated}
              highIntent={isAuthenticated && event ? isHighIntentForPush(event.dateTime, myRsvpStatus) : false}
            />

            {/* #457 Organizer-only attendance summary — now rendered inside the PlayerList footer. */}

            {/* Header */}
            <EventHeader
              eventId={eventId}
              event={event}
              sport={sport}
              gameDate={gameDate}
              countdown={countdown}
              canEditSettings={canEditSettings}
              isOwner={isOwner}
              isAuthenticated={isAuthenticated}
              isOwnerless={isOwnerless}
              localMatches={localMatches}
              onSaveTitle={handleSaveTitle}
              onSaveLocation={handleSaveLocation}
              onSaveDateTime={handleSaveDateTime}
              onSaveSport={handleSaveSport}
              onClaimOwnership={handleClaimOwnership}
              onSnackbar={setSnackbar}
            />

            {/* Organizer toolbar — quick actions for owner/admin */}
            {canEditSettings && (
              <Paper elevation={0} sx={{ borderRadius: 3, px: 2, py: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 1, bgcolor: (theme) => `${theme.palette.action.hover}` }}>
                <Tooltip title={t("randomize")}>
                  <IconButton size="small" onClick={() => localMatches ? setConfirmOpen(true) : doRandomize()}>
                    <ShuffleIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("shareGameMobile")}>
                  <IconButton size="small" onClick={() => { if (navigator.share) navigator.share({ title: event.title, url: window.location.href }).catch(() => {}); else { navigator.clipboard.writeText(window.location.href); setSnackbar(t("linkCopied")); } }}>
                    <ShareIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("splitTheCost")}>
                  <IconButton size="small" onClick={() => { setPaymentExpanded(true); setTimeout(() => document.getElementById("payment-section")?.scrollIntoView({ behavior: "smooth", block: "start" }), 100); }}>
                    <PaymentsIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("eventSettings")}>
                  <IconButton size="small" component="a" href={`/events/${eventId}/settings`}>
                    <SettingsIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Paper>
            )}

            {/* Location card — prominent when game is <24h away (the "where do I go?" moment) */}
            {event.location && gameDate.getTime() - Date.now() > 0 && gameDate.getTime() - Date.now() < 24 * 60 * 60 * 1000 && (
              <Paper
                elevation={1}
                component="a"
                href={/^https?:\/\//i.test(event.location)
                  ? event.location
                  : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.location)}`}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  borderRadius: 3, p: 2,
                  display: "flex", alignItems: "center", gap: 1.5,
                  textDecoration: "none", color: "inherit",
                  bgcolor: (theme) => `${theme.palette.primary.main}08`,
                  border: (theme) => `1px solid ${theme.palette.primary.main}30`,
                  "&:hover": { bgcolor: (theme) => `${theme.palette.primary.main}12` },
                  transition: "background-color 0.15s",
                }}
              >
                <Box sx={{ width: 40, height: 40, borderRadius: 2, bgcolor: "primary.main", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                  <Typography sx={{ color: "white", fontSize: 20 }}>📍</Typography>
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" fontWeight={700} noWrap>
                    {t("getDirections")}
                  </Typography>
                  <Typography variant="caption" color="text.secondary" noWrap>
                    {event.location}
                  </Typography>
                </Box>
              </Paper>
            )}

            {/* RSVP CTA — above the fold, the primary action for every visitor */}
            {isAuthenticated ? (
              <AttendanceCta
                myRsvpStatus={myRsvpStatus ?? null}
                isOnList={!!(session?.user?.id && event.players.some((p) => p.userId === session.user!.id))}
                onGoing={() => {
                  const isOnList = session?.user?.id && event.players.some((p) => p.userId === session.user!.id);
                  if (isOnList) {
                    handleSetMyRsvp("yes");
                  } else if (session?.user?.name) {
                    handleQuickJoinPillClick(session.user.name);
                  }
                }}
                onNotComing={() => {
                  handleSetMyRsvp("no");
                }}
              />
            ) : (
              <Paper elevation={1} sx={{ borderRadius: 3, p: 2, textAlign: "center" }}>
                <Button
                  variant="contained"
                  color="primary"
                  size="large"
                  href="/api/auth/signin"
                  sx={{ borderRadius: 2, textTransform: "none", fontWeight: 700 }}
                >
                  {t("signInToJoin")}
                </Button>
              </Paper>
            )}

            {/* Post-game banner — only for authenticated users who can act on it */}
            {isAuthenticated && (
            <PostGameBanner
              eventId={eventId}
              canEdit={canEditSettings}
              onStatusChange={setPostGameStatus}
              refreshKey={bannerRefreshKey}
              onScrollToScore={() => {
                window.location.href = `/events/${eventId}/history`;
              }}
              onScrollToPayments={() => {
                setPaymentExpanded(true);
                setTimeout(() => {
                  const el = document.getElementById("payment-section");
                  if (el) {
                    const y = el.getBoundingClientRect().top + window.scrollY - 80;
                    window.scrollTo({ top: y, behavior: "smooth" });
                  }
                }, 100);
              }}
            />
            )}

            {/* Payment tracking — hidden for unauthenticated users */}
            {isAuthenticated && (event.splitCostsEnabled !== false) && (
              <PaymentSection
                eventId={eventId}
                canEdit={canEditSettings}
                activePlayerCount={Math.min(event.players.length, event.maxPlayers)}
                expanded={paymentExpanded}
                onExpandedChange={(exp) => setPaymentExpanded(exp ? true : undefined)}
                onPaymentChange={() => setBannerRefreshKey((k) => k + 1)}
                gamePhase={new Date(event.dateTime) > new Date() ? "upcoming" : "past"}
                currentUserName={session?.user?.name ?? null}
              />
            )}

            {/* Players — single merged component (name+email+contacts+pills).
                The Quick Join pill is the first pill in the row when authenticated. */}
            <div data-player-list>
            <PlayerList
              players={event.players}
              maxPlayers={event.maxPlayers}
              isOwner={isOwner}
              hasTeams={!!(localMatches && localMatches.length > 0)}
              availableSuggestions={availableSuggestions}
              playerError={playerError}
              onPlayerErrorChange={setPlayerError}
              onAddPlayer={(name, email) => addPlayer(name, false, email)}
              onRequestAdd={requestAddPlayer}
              onRemovePlayer={removePlayer}
              onReorderPlayers={reorderPlayers}
              onResetPlayerOrder={resetPlayerOrder}
              onRandomize={doRandomize}
              onConfirmReRandomize={() => setConfirmOpen(true)}
              canRemovePlayer={canRemovePlayer}
              currentUserId={isAuthenticated ? session?.user?.id : null}
              myRsvpStatus={myRsvpStatus}
              guestRsvpMap={guestRsvpMap}
              userRsvpMap={userRsvpMap}
              canEditGuestAttendance={isOwner || isAdmin}
              onSetMyRsvp={handleSetMyRsvp}
              onSetGuestRsvp={handleSetGuestRsvp}
              onJoinAsSelf={isAuthenticated && session?.user?.name
                ? () => handleQuickJoinPillClick(session.user!.name)
                : undefined}
              eventDateTime={event.dateTime}
              />
            </div>

            {/* Payment nudge dialog — opened by the Quick Join pill on tap when the user
                has an outstanding balance. Also auto-opens from ?action=pay deep link. */}
            {isAuthenticated && session?.user?.name && (
              <PaymentNudgeDialog
                eventId={event.id}
                open={paymentNudgeOpen}
                onClose={() => setPaymentNudgeOpen(false)}
                onJoin={async () => {
                  setPaymentNudgeOpen(false);
                  await addPlayer(session.user!.name, true);
                }}
              />
            )}

            {/* Teams — shown below players after randomization */}
            {localMatches && localMatches.length > 0 && (
              <Paper elevation={2} sx={{ borderRadius: 3, p: { xs: 2, sm: 3 } }}>
                <Stack spacing={3}>
                  <Typography variant="h6" fontWeight={600}>{t("teams")}</Typography>
                  <TeamPicker
                    matches={localMatches.map((m) => ({
                      ...m,
                      team: m.team === event.teamOneName ? teamOneName
                        : m.team === event.teamTwoName ? teamTwoName : m.team,
                    }))}
                    onResultChange={handleTeamChange}
                    ratingsMap={balanced && !event.hideEloInTeams ? ratingsMap : undefined}
                    onTeamNameSave={canEditSettings ? (teamIdx, newName) => {
                      if (teamIdx === 0) {
                        setTeamOneName(newName);
                        handleTeamNameSave(newName, teamTwoName);
                      } else {
                        setTeamTwoName(newName);
                        handleTeamNameSave(teamOneName, newName);
                      }
                    } : undefined}
                  />
                </Stack>
              </Paper>
            )}

          </Stack>
        </Container>

        <EventDialogs
          confirmOpen={confirmOpen}
          onConfirmClose={() => setConfirmOpen(false)}
          onConfirmRandomize={doRandomize}
          relinquishConfirmOpen={relinquishConfirmOpen}
          onRelinquishClose={() => setRelinquishConfirmOpen(false)}
          onRelinquishConfirm={handleRelinquishOwnership}
          snackbar={snackbar}
          onSnackbarClose={() => setSnackbar(null)}
          undoData={undoData}
          onUndoDismiss={() => setUndoData(null)}
          onUndo={handleUndo}
        />

        <AddPlayerConfirmDialog
          intent={addIntent}
          eventName={event.title}
          isBench={event.players.length >= event.maxPlayers}
          hasInviteEmail={!!(addIntent?.email && addIntent.email.trim())}
          isAdding={!!addInFlightName}
          onConfirm={handleConfirmAdd}
          onClose={() => setAddIntent(null)}
        />
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
