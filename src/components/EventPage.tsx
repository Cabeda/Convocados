/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, user interactions mutate it, server data resyncs on refetch. Setting from async fetch callbacks is also fine. */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Container, Paper, Typography, Box, Stack, Button,
  Alert, Skeleton, ToggleButton, ToggleButtonGroup,
} from "@mui/material";
import EventRepeatIcon from "@mui/icons-material/EventRepeat";
import ViewListIcon from "@mui/icons-material/ViewList";
import StadiumIcon from "@mui/icons-material/Stadium";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { TeamPicker, type CrewHeaderChip, type PlayerStake } from "./TeamPicker";
import StakesPreview from "./StakesPreview";
import { useStakes } from "~/lib/useStakes";
import {
  crewMapFromLineup,
  liveContribution,
  liveCrewRoundScore,
  OUTCOMES,
  type MatchOutcome,
} from "~/lib/stakesPreview";
import { TeamField } from "./TeamField";
import type { Imatch } from "~/lib/random";
import { useLocale } from "~/lib/useT";
import { addKnownName, getQjName } from "~/lib/knownNames";
import { formatDateInTz, fromDateTimeLocalValue } from "~/lib/timezones";
import { isGameEnded } from "~/lib/gameStatus";
import { mergeSuggestionPills } from "~/lib/suggestionPills";
import { useSession } from "~/lib/auth.client";
import { apiRequest, ApiError } from "~/lib/api/client";

import {
  EventHeader,
  PlayerList,
  PaymentNudgeDialog,
  EventDialogs,
  PasswordPrompt,
  useCountdown,
  AddPlayerConfirmDialog,
  CreatedShareNudge,
  InviteShareDialog,
  InviteBanner,
  type AddPlayerIntent,
} from "./event";
import type { EventData, Player, KnownPlayer } from "./event";
import { PostGameBanner } from "./PostGameBanner";
import type { PostGameStatus } from "./PostGameBanner";
import { SignInButton } from "./SignInButton";
import { PushPromptBanner } from "./PushPromptBanner";
import { ConfirmLeaveDialog, computeBenchEmptyAfter, computeWithin48h } from "./event/ConfirmLeaveDialog";
import { deriveEventPermissions, canRemoveEventPlayer, findSelfRosterRow } from "~/lib/eventView";
import { decidePaymentGate } from "~/lib/paymentGate";
import { splitRoster } from "~/lib/rosterCapacity";


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

/** The server's message from a failed `apiRequest`, or the page's localized fallback. */
function apiErrorMessage(error: unknown, fallback: string): string {
  return error instanceof ApiError ? error.message : fallback;
}

export default function EventPage({ eventId }: { eventId: string }) {
  const { locale, t } = useLocale();
  const { data: session, refetch: refetchSession } = useSession();

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
  const [earlyDrawOpen, setEarlyDrawOpen] = useState(false);
  const [snackbar, setSnackbar] = useState<string | null>(null);
  const [inviteShare, setInviteShare] = useState<{ url: string; name: string } | null>(null);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [balanced, setBalanced] = useState(false);
  const [_isPublic, setIsPublic] = useState(false);
  const [sport, setSport] = useState("football-5v5");
  const [relinquishConfirmOpen, setRelinquishConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelConfirmBusy, setCancelConfirmBusy] = useState(false);
  // #1269: self-leave confirm for the hero row — both the linked (userId) and
  // the name-matched unlinked path go through it (review F4 consistency).
  const [selfLeave, setSelfLeave] = useState<{
    open: boolean; benchEmptyAfter: boolean; within48h: boolean; busy: boolean;
  }>({ open: false, benchEmptyAfter: false, within48h: false, busy: false });
  const [_postGameStatus, setPostGameStatus] = useState<PostGameStatus | null>(null);

  // ── ELO ratings for balanced mode ───────────────────────────────────────────
  const [ratingsResponse, setRatingsResponse] = useState<{ data: { name: string; rating: number }[] } | null>(null);
  useEffect(() => {
    if (!balanced) { setRatingsResponse(null); return; }
    const controller = new AbortController();
    apiRequest("GET /api/events/{id}/ratings", {
      params: { id: eventId },
      query: { limit: 100 },
      init: { signal: controller.signal },
    })
      .then((data) => setRatingsResponse(data as { data: { name: string; rating: number }[] }))
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

  // The server renders a read-only event summary into the body so clients that
  // do not run JS (agents, crawlers) can read the event. Once this island
  // hydrates it takes over the page, so drop the summary to avoid duplication.
  useEffect(() => {
    document.querySelector("[data-ssr-event-summary]")?.remove();
  }, []);

  // ── Team state ──────────────────────────────────────────────────────────────
  const [localMatches, setLocalMatches] = useState<Imatch[] | null>(null);
  const [teamOneName, setTeamOneName] = useState("");
  const [teamTwoName, setTeamTwoName] = useState("");
  const [isRandomizing, setIsRandomizing] = useState(false);
  const [shuffleVersion, setShuffleVersion] = useState(0);
  const [teamView, setTeamView] = useState<"list" | "field">("list");

  // ── Event data ──────────────────────────────────────────────────────────────
  const [event, setEvent] = useState<EventData | null>(null);
  const [error, setError] = useState<{ status?: number } | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [lockedEvent, setLockedEvent] = useState<{ id: string; title: string } | null>(null);

  // Roster is frozen once the game has ended — players can no longer be added
  // from the event page (server gate in POST /players; UI hides add surfaces).
  const gameEnded = useMemo(
    () => (event ? isGameEnded(event.dateTime, event.durationMinutes) : false),
    [event],
  );

  // Invite token from ?inviteToken=xxx — lets the link bypass password and shows a banner.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = new URLSearchParams(window.location.search).get("inviteToken");
    if (token) setInviteToken(token);
  }, []);

  const fetchEvent = useCallback(async () => {
    try {
      const data = (await apiRequest("GET /api/events/{id}", {
        params: { id: eventId },
        query: { inviteToken: inviteToken ?? undefined },
      })) as EventData & { locked?: boolean };
      if (data.locked) {
        setLockedEvent({ id: data.id, title: data.title });
        setEvent(null);
      } else {
        setEvent(data);
        setLockedEvent(null);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? { status: 404 } : {});
    } finally {
      setIsLoading(false);
    }
  }, [eventId, inviteToken]);

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
    apiRequest("GET /api/events/{id}/known-players", {
      params: { id: eventId },
      init: { signal: controller.signal },
    })
      .then((data) => setKnownPlayersData(data as { players: KnownPlayer[] }))
      .catch(() => {});
    return () => controller.abort();
  }, [eventId]);

  // ── Global co-players (people I played with on ANY event) for autocomplete ──
  const [coPlayersData, setCoPlayersData] = useState<{ players: Array<{ name: string; userId: string; image: string | null; coPlayCount: number }> } | null>(null);
  useEffect(() => {
    if (!session?.user) return;
    const controller = new AbortController();
    apiRequest("GET /api/me/co-players", { init: { signal: controller.signal } })
      .then((d) => setCoPlayersData(d as {
        players: Array<{ name: string; userId: string; image: string | null; coPlayCount: number }>;
      }))
      .catch(() => {});
    return () => controller.abort();
  }, [eventId, session?.user]);

  // ── ADR 0025: co-play suggestions (owner/admin only) ───────────────────────
  interface CoPlaySuggestion { userId: string; name: string; image?: string | null; gamesPlayed?: number; score?: number; reason?: string }
  const [coPlaySuggestions, setCoPlaySuggestions] = useState<CoPlaySuggestion[]>([]);
  const perms = deriveEventPermissions(
    session?.user?.id ?? null,
    { ownerId: event?.ownerId ?? null, isPublic: !!event?.isPublic, isAdmin: !!event?.isAdmin },
    { isParticipant: !!session?.user && !!event?.players.some((p) => p.userId === session.user!.id) },
  );
  const isOwnerFlag = perms.isOwner;
  const isAdminFlag = perms.isAdmin;
  useEffect(() => {
    if (!(isOwnerFlag || isAdminFlag) || !event?.gameId) {
      setCoPlaySuggestions([]);
      return;
    }
    const controller = new AbortController();
    apiRequest("GET /api/events/{id}/suggestions", {
      params: { id: eventId },
      init: { signal: controller.signal },
    })
      .then((d) => {
        const json = d as { suggestions?: CoPlaySuggestion[] } | undefined;
        setCoPlaySuggestions(Array.isArray(json?.suggestions) ? json.suggestions : []);
      })
      .catch(() => {});
    return () => controller.abort();
  }, [eventId, event?.gameId, isOwnerFlag, isAdminFlag]);

  /** ADR 0025: send a PlayerInvite to a suggested user (owner/admin). */
  const [invitingName, setInvitingName] = useState<string | null>(null);
  const invitePlayer = useCallback(async (userId: string, name: string) => {
    setPlayerError(null);
    setInvitingName(name);
    try {
      const json = (await apiRequest("POST /api/events/{id}/invites", {
        params: { id: eventId },
        body: { userId },
      })) as { channels?: unknown; inviteUrl?: unknown };
      // Always surface the shareable link so the organizer can copy/share
      // via WhatsApp etc., even when push/email channels are enabled.
      const channels = json?.channels as { email?: boolean; webPush?: boolean; appPush?: boolean } | undefined;
      const anyChannel = !!(channels?.email || channels?.webPush || channels?.appPush);
      if (typeof json?.inviteUrl === "string") {
        if (anyChannel) {
          const labels: string[] = [];
          if (channels?.email) labels.push(t("channelEmail"));
          if (channels?.webPush) labels.push(t("channelWebPush"));
          if (channels?.appPush) labels.push(t("channelAppPush"));
          setSnackbar(t("inviteSentVia", { name, channels: labels.join(", ") }));
        }
        setInviteShare({ url: json.inviteUrl, name });
      } else if (anyChannel) {
        const labels: string[] = [];
        if (channels?.email) labels.push(t("channelEmail"));
        if (channels?.webPush) labels.push(t("channelWebPush"));
        if (channels?.appPush) labels.push(t("channelAppPush"));
        setSnackbar(t("inviteSentVia", { name, channels: labels.join(", ") }));
      } else {
        setSnackbar(t("inviteSent", { name }));
      }
      fetchEvent();
    } catch (e) {
      setPlayerError(apiErrorMessage(e, t("somethingWentWrong")));
    } finally {
      setInvitingName(null);
    }
  }, [eventId, fetchEvent, t]);

  // ── ADR 0025 follow-up: resend a pending invite (24h cooldown enforced server-side) ──
  const [resendingInviteId, setResendingInviteId] = useState<string | null>(null);
  const resendInvite = useCallback(async (invite: { id: string; inviteId?: string | null; name: string }) => {
    const inviteIdForAction = invite.inviteId ?? invite.id;
    setResendingInviteId(inviteIdForAction);
    try {
      const json = (await apiRequest("PATCH /api/events/{id}/invites", {
        params: { id: eventId },
        body: { inviteId: inviteIdForAction },
      })) as { channels?: unknown };
      const channels = json?.channels as { email?: boolean; webPush?: boolean; appPush?: boolean } | undefined;
      const labels: string[] = [];
      if (channels?.email) labels.push(t("channelEmail"));
      if (channels?.webPush) labels.push(t("channelWebPush"));
      if (channels?.appPush) labels.push(t("channelAppPush"));
      setSnackbar(labels.length > 0
        ? t("inviteResentVia", { name: invite.name, channels: labels.join(", ") })
        : t("inviteSent", { name: invite.name }));
      fetchEvent();
    } catch (e) {
      const retryAfter = e instanceof ApiError && e.status === 429
        ? (e.payload as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds
        : undefined;
      if (typeof retryAfter === "number") {
        const mins = Math.ceil(retryAfter / 60);
        const time = mins >= 60 ? `${Math.floor(mins / 60)}h ${mins % 60}m` : `${mins}m`;
        setSnackbar(t("inviteResendCooldown", { time }));
      } else {
        setPlayerError(apiErrorMessage(e, t("somethingWentWrong")));
      }
    } finally {
      setResendingInviteId(null);
    }
  }, [eventId, fetchEvent, t]);

  // ── ADR 0025 follow-up: retract (remove) a pending invite ────────────────────
  const [retractingInviteId, setRetractingInviteId] = useState<string | null>(null);
  const retractInvite = useCallback(async (invite: { id: string; inviteId?: string | null; name: string }) => {
    const inviteIdForAction = invite.inviteId ?? invite.id;
    if (!window.confirm(t("inviteRetractConfirm", { name: invite.name }))) return;
    setRetractingInviteId(inviteIdForAction);
    try {
      await apiRequest("DELETE /api/events/{id}/invites", {
        params: { id: eventId },
        body: { inviteId: inviteIdForAction },
      });
      setSnackbar(t("inviteRetracted", { name: invite.name }));
      fetchEvent();
    } catch (e) {
      setPlayerError(apiErrorMessage(e, t("somethingWentWrong")));
    } finally {
      setRetractingInviteId(null);
    }
  }, [eventId, fetchEvent, t]);

  // ── Payment-nudge state ────────────────────────────────────────────────────
  // Fetched lazily on first pill click; controls whether the Quick Join pill
  // routes through the payment-nudge dialog (when the user has a balance) or
  // joins directly. The dialog also re-fetches its own copy of the balance.
  const [paymentNudgeOpen, setPaymentNudgeOpen] = useState(false);
  // Full decidePaymentGate inputs from GET /balance — keeps the Quick Join
  // client mirror on exactly the same threshold/gate-balance the server uses.
  const [cachedBalance, setCachedBalance] = useState<{ amount: number; gateAmount: number; enforcement: string; threshold: number } | null>(null);
  const refreshBalance = useCallback(async () => {
    try {
      const j = (await apiRequest("GET /api/events/{id}/balance", {
        params: { id: eventId },
      })) as {
        callerBalance?: { amount?: number };
        gateAmount?: number;
        enforcement?: string;
        threshold?: number;
      };
      const amt = j?.callerBalance?.amount ?? 0;
      setCachedBalance({
        amount: amt,
        gateAmount: j?.gateAmount ?? amt,
        enforcement: j?.enforcement ?? "off",
        threshold: j?.threshold ?? 0,
      });
    } catch { /* ignore */ }
  }, [eventId]);

  useEffect(() => {
    if (autoOpenPay && !gameEnded) {
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
      window.location.href = `/events/${eventId}/payments`;
    }
  }, [autoOpenPay, deepLinkAction, deepLinkPlayer, refreshBalance, eventId, gameEnded]);

  const mergedSuggestions = useMemo(() => {
    const qjName = getQjName().trim();
    // This event's history first (transparent "X games here"), then global
    // co-players (transparent "played with you Y×") — deduped by name, event
    // history wins so the per-event count is shown when both exist.
    const byName = new Map<string, { name: string; gamesPlayed: number; userId: string | null; image: string | null; coPlayCount: number }>();
    for (const p of knownPlayersData?.players ?? []) {
      byName.set(p.name.toLowerCase(), {
        name: p.name,
        gamesPlayed: p.gamesPlayed ?? 1,
        userId: p.userId ?? null,
        image: p.image ?? null,
        coPlayCount: 0,
      });
    }
    for (const cp of coPlayersData?.players ?? []) {
      const key = cp.name.toLowerCase();
      const existing = byName.get(key);
      if (existing) {
        // Same person in both lists — keep the per-event count, absorb the
        // co-play count so the "from another event" signal survives (matches
        // Android mergePlayerSuggestions).
        byName.set(key, { ...existing, coPlayCount: cp.coPlayCount });
        continue;
      }
      byName.set(key, {
        name: cp.name,
        gamesPlayed: 0,
        userId: cp.userId,
        image: cp.image ?? null,
        coPlayCount: cp.coPlayCount,
      });
    }
    return [...byName.values()]
      .sort((a, b) => {
        if (qjName && a.name.toLowerCase() === qjName.toLowerCase()) return -1;
        if (qjName && b.name.toLowerCase() === qjName.toLowerCase()) return 1;
        return (b.gamesPlayed + b.coPlayCount) - (a.gamesPlayed + a.coPlayCount);
      });
  }, [knownPlayersData, coPlayersData]);

  const currentPlayerNames = useMemo(
    () => new Set((event?.players ?? []).map((p) => p.name.toLowerCase())),
    [event?.players]
  );

  const availableSuggestions = useMemo(
    () => mergedSuggestions.filter((s) => !currentPlayerNames.has(s.name.toLowerCase())),
    [mergedSuggestions, currentPlayerNames]
  );

  // dex f79w7x29: while the roster has room the pills section must never be
  // empty — ranked inviteable suggestions come first, then this event's known
  // players + global co-players fill the rest (add-or-invite dialog handles
  // anonymous guests as direct adds / link-share, since they can't be notified).
  const suggestionPills = useMemo(
    () => mergeSuggestionPills(
      coPlaySuggestions,
      availableSuggestions.map((s) => ({ name: s.name, userId: s.userId, image: s.image })),
      { currentNames: currentPlayerNames },
    ).pills,
    [coPlaySuggestions, availableSuggestions, currentPlayerNames]
  );

  const notFound = error?.status === 404;

  // Server team results use raw team identifiers; swap in the (possibly
  // renamed) display names once for both the list and field views.
  const displayMatches = useMemo(() => {
    if (!localMatches || !event) return localMatches;
    return localMatches.map((m) => ({
      ...m,
      team: m.team === event.teamOneName ? teamOneName
        : m.team === event.teamTwoName ? teamTwoName : m.team,
    }));
  }, [localMatches, event, teamOneName, teamTwoName]);

  // Stakes Preview inputs: the two drawn lineups, or null until both have players.
  const stakeLineups = useMemo(() => {
    if (!displayMatches || displayMatches.length < 2) return null;
    const teamOne = displayMatches[0].players.map((p) => p.name);
    const teamTwo = displayMatches[1].players.map((p) => p.name);
    if (teamOne.length === 0 || teamTwo.length === 0) return null;
    return { teamOne, teamTwo };
  }, [displayMatches]);

  // Stakes Preview data + live client-side derivation (ADR 0050). Contributions
  // and Crew round scores depend only on side assignment, so they update on drag;
  // Rank deltas and standings positions refresh from the debounced request.
  const stakes = useStakes(event?.id ?? "", stakeLineups?.teamOne ?? [], stakeLineups?.teamTwo ?? []);
  const crewMap = useMemo(() => crewMapFromLineup(stakes.data?.lineup ?? []), [stakes.data]);
  const stakeScenario = stakes.scenario;
  const livePoints = useMemo(
    () => (stakeLineups && stakeScenario
      ? liveContribution(stakeLineups.teamOne, stakeLineups.teamTwo, stakeScenario.outcome)
      : null),
    [stakeLineups, stakeScenario],
  );
  const liveCrewScore = useMemo(() => {
    if (!stakeLineups || !livePoints) return {};
    const roster = [
      ...stakeLineups.teamOne.map((name) => ({ name, side: "teamOne" as const })),
      ...stakeLineups.teamTwo.map((name) => ({ name, side: "teamTwo" as const })),
    ];
    return liveCrewRoundScore(roster, crewMap, livePoints);
  }, [stakeLineups, livePoints, crewMap]);
  const stakeMap = useMemo(() => {
    if (!stakeScenario) return undefined;
    const map: Record<string, PlayerStake> = {};
    for (const p of stakeScenario.players) {
      map[p.name] = {
        contribution: livePoints?.[p.name] ?? p.contribution,
        rpDelta: p.rpDelta,
        passed: p.passed,
        provisional: p.provisional,
      };
    }
    return map;
  }, [stakeScenario, livePoints]);
  const crewChipsByTeamIndex = useMemo<CrewHeaderChip[][] | undefined>(() => {
    if (!stakeScenario) return undefined;
    return (["teamOne", "teamTwo"] as const).map((side) => {
      const crewIds = [
        ...new Set(stakeScenario.players.filter((p) => p.side === side && p.crewId).map((p) => p.crewId as string)),
      ];
      return crewIds.flatMap((crewId) => {
        const c = stakeScenario.crews.find((x) => x.crewId === crewId);
        return c
          ? [{ crewId, name: c.name, roundScore: liveCrewScore[crewId] ?? c.roundScore, positionAfter: c.positionAfter, passed: c.passed }]
          : [];
      });
    });
  }, [stakeScenario, liveCrewScore]);
  const stakesOutcomeLabel = (outcome: MatchOutcome) =>
    outcome === "teamOne"
      ? t("stakesPreviewOutcomeOne", { team: teamOneName || t("stakesPreviewTeamOne") })
      : outcome === "teamTwo"
        ? t("stakesPreviewOutcomeTwo", { team: teamTwoName || t("stakesPreviewTeamTwo") })
        : t("stakesPreviewOutcomeDraw");

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
        formation: tr.formation ?? null,
        players: tr.members.map((m) => ({ name: m.name, order: m.order, slot: m.slot ?? null })),
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
    position?: string,
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
      const json = (await apiRequest("POST /api/events/{id}/players", {
        params: { id: eventId },
        body: {
          name: trimmed,
          linkToAccount,
          ...(email ? { email: email.trim() } : {}),
          ...(position ? { position } : {}),
        },
        init: {
          headers: {
            "X-Client-Id": clientIdRef.current,
            "Idempotency-Key": idempotencyKey,
          },
        },
      })) as { resolvedName?: string; anonymous?: boolean };
      const resolvedName: string | undefined = json.resolvedName;
      // Anonymous player (no account): no notification channel exists — surface
      // the share-by-link option right away so the inviter can reach them.
      if (json.anonymous === true) {
        setInviteShare({ url: window.location.href, name: resolvedName ?? trimmed });
      } else if (resolvedName && resolvedName !== trimmed && trimmed) {
        setSnackbar(`Added ${resolvedName} ✓`);
      }
      addKnownName(resolvedName ?? trimmed);
      fetchEvent();
    } catch (e) {
      setPlayerError(apiErrorMessage(e, t("somethingWentWrong")));
      fetchEvent(); // revert optimistic update
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
  const addPlayer = async (name: string, linkToAccount = false, email?: string, position?: string) => {
    const idempotencyKey = crypto.randomUUID();
    await performAdd(name, linkToAccount, email, idempotencyKey, position);
  };

  /** #1448: set or clear one roster row's position. */
  const setPlayerPosition = async (name: string, position: string | null) => {
    try {
      await apiRequest("PATCH /api/events/{id}/players", {
        params: { id: eventId },
        body: { name, position },
        init: { headers: { "X-Client-Id": clientIdRef.current } },
      });
    } catch (e) {
      setSnackbar(apiErrorMessage(e, t("somethingWentWrong")));
      return;
    }
    setEvent((current) => current && {
      ...current,
      players: current.players.map((p) => (p.name === name ? { ...p, position } : p)),
    });
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

  // Single place for all roster intents — Add (active) vs Invite (pending).
  // Both chip/dropdown/input paths funnel through here, so the add/invite
  // decision is in one spot and the two API flows (players vs invites) are
  // not duplicated across the codebase.
  const handleConfirm = async (intent: AddPlayerIntent, asInvite: boolean, via: "notify" | "link" = "notify") => {
    setAddIntent(null);
    if (asInvite && via === "link") {
      // Share-a-link flow: create the invite token silently (deliver:false —
      // no email/push/in-app notification) and hand the URL to the Web Share
      // API dialog so the inviter delivers it themselves.
      setPlayerError(null);
      setInvitingName(intent.name);
      try {
        const json = (await apiRequest("POST /api/events/{id}/invites", {
          params: { id: eventId },
          body: intent.userId
            ? { userId: intent.userId, deliver: false }
            : intent.email
              ? { email: intent.email, deliver: false }
              : { name: intent.name },
        })) as { inviteUrl?: unknown };
        if (typeof json?.inviteUrl === "string") {
          setInviteShare({ url: json.inviteUrl, name: intent.name });
          fetchEvent();
          return;
        }
        setPlayerError(t("somethingWentWrong"));
      } catch (e) {
        setPlayerError(apiErrorMessage(e, t("somethingWentWrong")));
      } finally {
        setInvitingName(null);
      }
      return;
    }
    if (asInvite) {
      if (intent.email) {
        // Invite by email: for registered users create a pending PlayerInvite
        // (not a direct add). For unregistered emails the invites endpoint
        // returns 404 and we fall back to the direct-add-with-email flow
        // which sends the "invite to register" email.
        setPlayerError(null);
        setInvitingName(intent.name);
        try {
          const json = (await apiRequest("POST /api/events/{id}/invites", {
            params: { id: eventId },
            body: { email: intent.email },
          })) as { channels?: unknown; inviteUrl?: unknown };
          const channels = json?.channels as { email?: boolean; webPush?: boolean; appPush?: boolean } | undefined;
          const anyChannel = !!(channels?.email || channels?.webPush || channels?.appPush);
          if (typeof json?.inviteUrl === "string") {
            if (anyChannel) {
              const labels: string[] = [];
              if (channels?.email) labels.push(t("channelEmail"));
              if (channels?.webPush) labels.push(t("channelWebPush"));
              if (channels?.appPush) labels.push(t("channelAppPush"));
              setSnackbar(t("inviteSentVia", { name: intent.name, channels: labels.join(", ") }));
            }
            setInviteShare({ url: json.inviteUrl, name: intent.name });
          } else if (anyChannel) {
            const labels: string[] = [];
            if (channels?.email) labels.push(t("channelEmail"));
            if (channels?.webPush) labels.push(t("channelWebPush"));
            if (channels?.appPush) labels.push(t("channelAppPush"));
            setSnackbar(t("inviteSentVia", { name: intent.name, channels: labels.join(", ") }));
          } else {
            setSnackbar(t("inviteSent", { name: intent.name }));
          }
          fetchEvent();
          return;
        } catch (e) {
          // An unregistered email is a 404 here; fall back to the direct-add flow.
          if (e instanceof ApiError && e.status === 404 && e.message.includes("No registered user")) {
            const idempotencyKey = crypto.randomUUID();
            await performAdd(intent.name, false, intent.email, idempotencyKey, intent.position);
            return;
          }
          setPlayerError(apiErrorMessage(e, t("somethingWentWrong")));
        } finally {
          setInvitingName(null);
        }
        return;
      }
      if (intent.userId) {
        await invitePlayer(intent.userId, intent.name);
        return;
      }
      return;
    }
    const idempotencyKey = crypto.randomUUID();
    await performAdd(intent.name, false, intent.email, idempotencyKey, intent.position);
  };

  // Routes the Quick Join pill click: opens the payment-nudge dialog when the user
  // has a balance, otherwise joins directly. Server PAYMENT_GATE 402 falls back to the dialog.
  // Client mirror of the server's payment gate: prompt when the shared decision
  // is anything but "allow". Uses the same gateAmount/threshold inputs the join
  // path feeds decidePaymentGate (GET /balance). The server stays authoritative
  // (PAYMENT_GATE 402).
  const gateWouldPrompt = (b: { amount: number; gateAmount: number; enforcement: string; threshold: number }) =>
    decidePaymentGate({
      enforcement: b.enforcement,
      isSelfService: true,
      outstandingAmount: b.amount,
      gateAmount: b.gateAmount,
      threshold: b.threshold,
    }) !== "allow";

  const handleQuickJoinPillClick = (name: string) => {
    const openDialog = () => setPaymentNudgeOpen(true);
    if (cachedBalance) {
      if (gateWouldPrompt(cachedBalance)) {
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
    apiRequest("GET /api/events/{id}/balance", { params: { id: eventId } })
      .then((data) => {
        const j = data as { callerBalance?: { amount?: number }; gateAmount?: number; enforcement?: string; threshold?: number };
        const amt = j?.callerBalance?.amount ?? 0;
        const balance = {
          amount: amt,
          gateAmount: j?.gateAmount ?? amt,
          enforcement: j?.enforcement ?? "off",
          threshold: j?.threshold ?? 0,
        };
        setCachedBalance(balance);
        if (gateWouldPrompt(balance)) {
          openDialog();
        } else {
          return addPlayer(name, true);
        }
      })
      .catch(() => { /* swallow — player can retry */ });
  };

  // ADR 0018: Auto-join deep link (needs handleQuickJoinPillClick to be defined)
  useEffect(() => {
    if (deepLinkAction === "join" && session?.user?.name && !gameEnded) {
      setTimeout(() => handleQuickJoinPillClick(session.user!.name), 500);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deepLinkAction, session?.user?.name, gameEnded]);

  const removePlayer = async (playerId: string) => {
    // Optimistic update
    setEvent((current) => {
      if (!current) return current;
      return { ...current, players: current.players.filter((p) => p.id !== playerId) };
    });

    try {
      const data = (await apiRequest("DELETE /api/events/{id}/players", {
        params: { id: eventId },
        body: { playerId },
        init: { headers: { "X-Client-Id": clientIdRef.current } },
      })) as { undo?: { name: string; order: number; userId: string | null; removedAt: number } };
      if (data.undo) {
        setUndoData({ eventId, ...data.undo });
      }
    } catch {
      // #1237: the x used to fail silently here, so a player the page still listed
      // had no way off it and no idea why. Localized text only — the server's error
      // is a raw English string and this UI is not English-only.
      setPlayerError(t("somethingWentWrong"));
      fetchEvent();
      return;
    }
    fetchEvent();
  };

  // ── Undo remove ─────────────────────────────────────────────────────────────
  const [undoData, setUndoData] = useState<{ eventId: string; name: string; order: number; userId: string | null; removedAt: number } | null>(null);

  const handleUndo = useCallback(async () => {
    if (!undoData) return;
    try {
      await apiRequest("POST /api/events/{id}/undo-remove", {
        params: { id: undoData.eventId },
        body: undoData,
      });
      fetchEvent();
    } catch (e) {
      setPlayerError(apiErrorMessage(e, t("somethingWentWrong")));
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
    await apiRequest("PUT /api/events/{id}/reorder-players", {
      params: { id: eventId },
      body: { playerIds: reorderedIds },
    }).catch(() => undefined);
    fetchEvent();
  }, [eventId, fetchEvent]);

  const resetPlayerOrder = useCallback(async () => {
    try {
      await apiRequest("POST /api/events/{id}/reset-player-order", { params: { id: eventId } });
      fetchEvent();
    } catch { /* nothing to show: the old code only refetched on success */ }
  }, [eventId, fetchEvent]);

  // ── Team operations ─────────────────────────────────────────────────────────

  const doRandomize = async () => {
    setConfirmOpen(false);
    setIsRandomizing(true);
    setShuffleVersion((version) => version + 1);
    try {
      await apiRequest("POST /api/events/{id}/randomize", {
        params: { id: eventId },
        query: { balanced: balanced || undefined },
      });
      await fetchEvent();
    } catch (e) {
      setPlayerError(apiErrorMessage(e, t("somethingWentWrong")));
    } finally {
      setIsRandomizing(false);
    }
  };

  const handleTeamChange = async (matches: Imatch[]) => {
    setLocalMatches(matches);
    isDraggingRef.current = true;
    try {
      await apiRequest("PUT /api/events/{id}/teams", {
        params: { id: eventId },
        body: { matches },
      });
    } catch (e) {
      setSnackbar(apiErrorMessage(e, "Failed to update teams"));
    } finally {
      isDraggingRef.current = false;
    }
    fetchEvent();
  };

  const handleTeamNameSave = async (one: string, two: string) => {
    await apiRequest("PUT /api/events/{id}/team-names", {
      params: { id: eventId },
      body: { teamOneName: one, teamTwoName: two },
    }).catch(() => undefined);
    fetchEvent();
  };

  // ── Title & location save ───────────────────────────────────────────────────

  const handleSaveTitle = async (title: string) => {
    // Optimistic update
    setEvent((e) => e ? { ...e, title } : e);
    // The route's response is unused; a refetch is the recovery path on either outcome.
    await apiRequest("PUT /api/events/{id}/title", { params: { id: eventId }, body: { title } })
      .catch(() => undefined);
    fetchEvent();
  };

  const handleSaveLocation = async (location: string) => {
    const data = (await apiRequest("PUT /api/events/{id}/location", {
      params: { id: eventId },
      body: { location },
    }).catch(() => null)) as { geocoded?: boolean } | null;
    if (location && !data?.geocoded) {
      setSnackbar(t("locationNotGeocoded"));
    }
    fetchEvent();
  };

  const handleSaveDateTime = async (dateTime: string, timezone: string) => {
    // Convert the datetime-local value (in the event's timezone) to a UTC ISO string
    const utcIso = fromDateTimeLocalValue(dateTime, timezone);
    await apiRequest("PUT /api/events/{id}/datetime", {
      params: { id: eventId },
      body: { dateTime: utcIso, timezone },
    }).catch(() => undefined);
    fetchEvent();
  };

  const handleSaveSport = async (sport: string) => {
    // The route's response is derived from the event; the refetch supplies it.
    await apiRequest("PUT /api/events/{id}/sport", { params: { id: eventId }, body: { sport } })
      .catch(() => undefined);
    fetchEvent();
  };

  // ── Ownership ───────────────────────────────────────────────────────────────

  const handleClaimOwnership = async () => {
    try {
      await apiRequest("POST /api/events/{id}/claim", { params: { id: eventId } });
      fetchEvent();
      setSnackbar(t("claimOwnership"));
    } catch { /* the old code ignored a failed claim */ }
  };

  const handleRelinquishOwnership = async () => {
    setRelinquishConfirmOpen(false);
    try {
      await apiRequest("DELETE /api/events/{id}/claim", { params: { id: eventId } });
      fetchEvent();
    } catch { /* the old code ignored a failed relinquish */ }
  };

  const handleCancelGame = async () => {
    setCancelConfirmBusy(true);
    try {
      await apiRequest("PUT /api/events/{id}/cancel", { params: { id: eventId } });
      setSnackbar(t("gameCancelledSnackbar"));
      fetchEvent();
    } catch (e) {
      setSnackbar(apiErrorMessage(e, t("somethingWentWrong")));
    } finally {
      setCancelConfirmBusy(false);
      setCancelConfirmOpen(false);
    }
  };

  // ── Derived state ───────────────────────────────────────────────────────────

  const gameDate = useMemo(() => event ? new Date(event.dateTime) : new Date(), [event]);
  const countdown = useCountdown(gameDate, t("gameTime"));

  const isAuthenticated = !!session?.user;
  const { isOwner, isAdmin, isOwnerless, canEditSettings, canManageInvites, canEditTeams } = perms;

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
    apiRequest("GET /api/events/{id}/rsvp", {
      params: { id: eventId },
      init: { credentials: "include" },
    })
      .then((data) => {
        if (!alive) return;
        setMyRsvpStatus(((data as { status?: unknown }).status ?? null) as "yes" | "no" | "maybe" | null);
      })
      .catch(() => alive && setMyRsvpStatus(null));
    return () => { alive = false; };
  }, [eventId, isAuthenticated]);

  const handleSetMyRsvp = useCallback(async (status: "yes" | "no") => {
    const prev = myRsvpStatus;
    setMyRsvpStatus(status); // optimistic
    try {
      // #XXX "no" goes through the leave endpoint: it sets Rsvp="no" AND archives the player.
      // "yes" stays on the plain rsvp endpoint (user stays on the player list).
      if (status === "no") {
        await apiRequest("POST /api/events/{id}/leave", {
          params: { id: eventId },
          init: { credentials: "include" },
        });
      } else {
        await apiRequest("POST /api/events/{id}/rsvp", {
          params: { id: eventId },
          body: { status },
          init: { credentials: "include" },
        });
      }
      setSnackbar(status === "yes" ? t("rsvpYesToast") : t("rsvpNoToast"));
      // Refetch event so the archived player disappears from the list.
      fetchEvent();
    } catch (e) {
      setMyRsvpStatus(prev);
      setSnackbar(apiErrorMessage(e, t("somethingWentWrong")));
    }
  }, [eventId, myRsvpStatus, t, fetchEvent]);

  const canRemovePlayer = (player: Player) =>
    canRemoveEventPlayer(
      session?.user?.id ?? null,
      { ownerId: event?.ownerId ?? null, isPublic: !!event?.isPublic, isAdmin: !!event?.isAdmin },
      player,
    );

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
                  date: formatDateInTz(gameDate, locale, event.timezone, {
                    weekday: "long", month: "long", day: "numeric",
                  }),
                })}
              </Alert>
            )}

            {inviteToken && event && (
              <InviteBanner token={inviteToken} eventId={event.id} onAccepted={fetchEvent} />
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
              gameStatus={event.gameStatus}
              onSaveTitle={handleSaveTitle}
              onSaveLocation={handleSaveLocation}
              onSaveDateTime={handleSaveDateTime}
              onSaveSport={handleSaveSport}
              onClaimOwnership={handleClaimOwnership}
              onCancelGame={() => setCancelConfirmOpen(true)}
              onSnackbar={setSnackbar}
            />

            {/* Post-game banner — only for authenticated users who can act on it.
                Seeded from the initial payload so an already-settled game never
                flashes the banner before the client fetch resolves. */}
            {isAuthenticated && (
            <PostGameBanner
              eventId={eventId}
              initialStatus={event?.postGameStatus ?? null}
              onStatusChange={setPostGameStatus}
              isManager={isOwner || isAdmin}
              onScrollToScore={() => {
                window.location.href = `/events/${eventId}/history`;
              }}
              onScrollToPayments={() => {
                window.location.href = `/events/${eventId}/payments`;
              }}
            />
            )}

            {/* Join / You joined — replaces YOUR RESPONSE (AttendanceCta) per #818.
                Web parity with Android hero revamp: single CTA, not Going/Not coming. */}
            {!gameEnded && (() => {
              if (!isAuthenticated) {
                return (
                  <Paper elevation={1} sx={{ borderRadius: 3, p: 2, textAlign: "center" }}>
                    <SignInButton
                      variant="contained"
                      color="primary"
                      size="large"
                      callbackURL={`/events/${eventId}`}
                      onSuccess={() => {
                        refetchSession?.();
                        fetchEvent();
                      }}
                      sx={{ borderRadius: 2, textTransform: "none", fontWeight: 700 }}
                    >
                      {t("signInToJoin")}
                    </SignInButton>
                  </Paper>
                );
              }
              // #1269: a linked row still matches on userId; an anonymous row added by
              // the organizer has no userId, so fall back to the normalized name match.
              const myPlayer = session?.user?.id ? findSelfRosterRow(event.players, session.user!) : null;
              // #1331: name-match is removal-only. A linked row (userId) counts as
              // participation and shows the "you joined as" hero; an unlinked
              // name-matched row only grants self-leave via the roster X.
              if (myPlayer?.userId) {
                const unlinked = false;
                const isOnBench = event.players.findIndex((p) => p.id === myPlayer.id) >= event.maxPlayers;
                return (
                  <Paper elevation={1} sx={{ borderRadius: 3, p: 2, display: "flex", alignItems: "center", gap: 1.5 }}>
                    <Typography variant="body2" fontWeight={600} sx={{ flex: 1, color: isOnBench ? "warning.main" : "primary.main" }}>
                      {isOnBench ? t("onBench", { name: myPlayer.name }) : t("youJoinedAs", { name: myPlayer.name })}
                    </Typography>
                    <Button
                      variant="outlined"
                      color="error"
                      size="small"
                      onClick={() => {
                        setSelfLeave({
                          open: true,
                          benchEmptyAfter: computeBenchEmptyAfter(
                            myPlayer.id, event.players,
                            splitRoster(event.players, event.maxPlayers).active, event.maxPlayers,
                          ),
                          within48h: computeWithin48h(event.dateTime),
                          busy: false,
                        });
                      }}
                    >
                      {t("leave")}
                    </Button>
                    <ConfirmLeaveDialog
                      open={selfLeave.open}
                      onClose={() => setSelfLeave((d) => ({ ...d, open: false }))}
                      onConfirm={async () => {
                        const rowId = myPlayer.id;
                        setSelfLeave((d) => ({ ...d, busy: true }));
                        try {
                          if (unlinked) {
                            // Removal only — never links the row to the account.
                            await removePlayer(rowId);
                          } else {
                            // Linked: the /leave endpoint resolves the row by userId.
                            await handleSetMyRsvp("no");
                          }
                        } finally {
                          setSelfLeave((d) => ({ ...d, open: false, busy: false }));
                        }
                      }}
                      context="self"
                      playerName={myPlayer.name}
                      benchEmptyAfter={selfLeave.benchEmptyAfter}
                      within48h={selfLeave.within48h}
                      busy={selfLeave.busy}
                    />
                  </Paper>
                );
              }
              return (
                <Paper elevation={1} sx={{ borderRadius: 3, p: 2, textAlign: "center" }}>
                  <Button
                    variant="contained"
                    color="primary"
                    size="large"
                    onClick={() => session?.user?.name && handleQuickJoinPillClick(session.user.name)}
                    sx={{ borderRadius: 2, textTransform: "none", fontWeight: 700 }}
                  >
                    {t("joinAs", { name: session?.user?.name ?? "" })}
                  </Button>
                </Paper>
              );
            })()}

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
              onAddPlayer={(name, email, position) => addPlayer(name, false, email, position)}
              onSetPosition={setPlayerPosition}
              positionsEnabled={event.positionsEnabled ?? false}
              onRequestAdd={requestAddPlayer}
              onRemovePlayer={removePlayer}
              onReorderPlayers={reorderPlayers}
              onResetPlayerOrder={resetPlayerOrder}
              onRandomize={doRandomize}
              onConfirmReRandomize={() => setConfirmOpen(true)}
              onConfirmEarlyRandomize={() => setEarlyDrawOpen(true)}
              isRandomizing={isRandomizing}
              canRemovePlayer={canRemovePlayer}
              onSetMyRsvp={handleSetMyRsvp}
              onJoinAsSelf={isAuthenticated && session?.user?.name
                ? () => handleQuickJoinPillClick(session.user!.name)
                : undefined}
              eventDateTime={event.dateTime}
              rosterLocked={gameEnded}
              declined={event.declined}
              invited={event.invited}
              canManageInvites={canManageInvites}
              onResendInvite={resendInvite}
              resendingInviteId={resendingInviteId}
              onRetractInvite={retractInvite}
              retractingInviteId={retractingInviteId}
              coPlaySuggestions={suggestionPills}
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
                <Stack spacing={2}>
                  <Stack direction="row" sx={{ alignItems: "center", justifyContent: "space-between" }}>
                    <Typography variant="h6" fontWeight={600}>{t("teams")}</Typography>
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      value={teamView}
                      onChange={(_e, next) => { if (next) setTeamView(next); }}
                      aria-label={t("teamViewToggleLabel")}
                    >
                      <ToggleButton value="list" aria-label={t("teamViewList")}>
                        <ViewListIcon fontSize="small" sx={{ mr: 0.5 }} />
                        {t("teamViewList")}
                      </ToggleButton>
                      <ToggleButton value="field" aria-label={t("teamViewField")}>
                        <StadiumIcon fontSize="small" sx={{ mr: 0.5 }} />
                        {t("teamViewField")}
                      </ToggleButton>
                    </ToggleButtonGroup>
                  </Stack>
                  {stakes.data?.roundAvailable && stakeScenario && (
                    <ToggleButtonGroup
                      size="small"
                      exclusive
                      fullWidth
                      value={stakes.scenarioIndex}
                      onChange={(_e, next) => { if (next !== null) stakes.setScenarioIndex(next); }}
                      aria-label={t("stakesPreviewTitle")}
                    >
                      {OUTCOMES.map((outcome, index) => (
                        <ToggleButton key={outcome} value={index} sx={{ textTransform: "none", fontWeight: 700 }}>
                          {stakesOutcomeLabel(outcome)}
                        </ToggleButton>
                      ))}
                    </ToggleButtonGroup>
                  )}
                  {teamView === "list" ? (
                    <TeamPicker
                      matches={displayMatches ?? []}
                      onResultChange={handleTeamChange}
                      shuffleKey={shuffleVersion}
                      ratingsMap={balanced && !event.hideEloInTeams ? ratingsMap : undefined}
                      canEdit={canEditTeams}
                      crewMap={stakeLineups ? crewMap : undefined}
                      stakeMap={stakeMap}
                      crewChipsByTeamIndex={crewChipsByTeamIndex}
                      rankEnabled={stakes.data?.rankEnabled ?? true}
                      viewerName={stakes.data?.viewerName}
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
                  ) : (
                    <TeamField
                      matches={displayMatches ?? []}
                      onResultChange={handleTeamChange}
                      shuffleKey={shuffleVersion}
                      ratingsMap={balanced && !event.hideEloInTeams ? ratingsMap : undefined}
                      sport={event.sport}
                      canEdit={canEditTeams}
                      crewMap={stakeLineups ? crewMap : undefined}
                      crewChipsByTeamIndex={crewChipsByTeamIndex}
                    />
                  )}
                  {stakes.data && (
                    <StakesPreview
                      seasonName={stakes.data.seasonName}
                      roundAvailable={stakes.data.roundAvailable}
                      roundsCounted={stakes.data.roundsCounted}
                      scenario={stakeScenario}
                      liveRoundScore={liveCrewScore}
                    />
                  )}
                </Stack>
              </Paper>
            )}

          </Stack>
        </Container>

        <EventDialogs
          confirmOpen={confirmOpen}
          onConfirmClose={() => setConfirmOpen(false)}
          onConfirmRandomize={doRandomize}
          earlyDrawOpen={earlyDrawOpen}
          onEarlyDrawClose={() => setEarlyDrawOpen(false)}
          onEarlyDrawConfirm={doRandomize}
          earlyDrawCount={{ n: Math.min(event.players.length, event.maxPlayers), max: event.maxPlayers }}
          relinquishConfirmOpen={relinquishConfirmOpen}
          onRelinquishClose={() => setRelinquishConfirmOpen(false)}
          onRelinquishConfirm={handleRelinquishOwnership}
          cancelConfirmOpen={cancelConfirmOpen}
          onCancelConfirmClose={() => setCancelConfirmOpen(false)}
          onCancelConfirm={handleCancelGame}
          cancelConfirmBusy={cancelConfirmBusy}
          isRecurring={event.isRecurring}
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
          isAdding={!!addInFlightName}
          isInviting={!!invitingName}
          onConfirm={handleConfirm}
          onClose={() => setAddIntent(null)}
        />

        <InviteShareDialog
          open={!!inviteShare}
          name={inviteShare?.name ?? ""}
          url={inviteShare?.url ?? ""}
          onClose={() => setInviteShare(null)}
        />

        <CreatedShareNudge title={event.title} />
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
