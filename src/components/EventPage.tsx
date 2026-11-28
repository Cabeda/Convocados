/* eslint-disable @eslint-react/set-state-in-effect, react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, user interactions mutate it, server data resyncs on refetch. Setting from async fetch callbacks is also fine. */
import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Container, Paper, Typography, Stack, Button,
  ToggleButton, ToggleButtonGroup,
} from "@mui/material";
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
import { fromDateTimeLocalValue } from "~/lib/timezones";
import { useSession } from "~/lib/auth.client";
import { apiRequest, ApiError, apiErrorMessage } from "~/lib/api/client";

import {
  EventHeader,
  EventDialogs,
  PasswordPrompt,
  CreatedShareNudge,
  InviteBanner,
} from "./event";
import { buildEventShareText, shareableUrl, shareEvent } from "./event/shareEvent";
import type { EventData } from "./event";
import { EventRecap, lastRecapShape } from "./event/story/EventRecap";
import { CancelledBanner } from "./event/story/CancelledBanner";
import { RecapSkeleton } from "./event/story/RecapSkeleton";
import { HeaderSkeleton } from "./event/story/HeaderSkeleton";
import { NextGame } from "./event/story/NextGame";
import { NextGameSkeleton } from "./event/story/NextGameSkeleton";
import { useHeaderToasts } from "./event/story/HeaderToast";
import { useMyRsvp } from "./event/story/useMyRsvp";
import type { NextGameHint } from "~/lib/nextGame";
import { useNextGamePhase } from "./event/story/useNextGamePhase";
import { parseRecurrenceRule } from "~/lib/recurrence";
import { PushPromptBanner } from "./PushPromptBanner";
import { deriveEventPermissions } from "~/lib/eventView";


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

export default function EventPage({ eventId, hasLastGame = false, nextGameHint }: { eventId: string; hasLastGame?: boolean; nextGameHint?: NextGameHint }) {
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
  const deepLinkShareHandled = useRef(false);

  // ── UI state ────────────────────────────────────────────────────────────────
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [earlyDrawOpen, setEarlyDrawOpen] = useState(false);
  const { queue: toastQueue, push: setSnackbar, next: nextToast } = useHeaderToasts();
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [balanced, setBalanced] = useState(false);
  const [_isPublic, setIsPublic] = useState(false);
  const [sport, setSport] = useState("football-5v5");
  const [relinquishConfirmOpen, setRelinquishConfirmOpen] = useState(false);
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const [cancelConfirmBusy, setCancelConfirmBusy] = useState(false);
  // The recap still has something for the viewer to do, so the RSVP is the quiet variant.
  const [recapBlocking, setRecapBlocking] = useState(false);

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

  const cancelled = event?.gameStatus === "cancelled";

  // Invite token from ?inviteToken=xxx — lets the link bypass password and shows a banner.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const token = new URLSearchParams(window.location.search).get("inviteToken");
    if (token) setInviteToken(token);
  }, []);

  // The viewer's own changes (join, leave, add, remove) show at once; until the server has them, a
  // poll that lands must not put the old list back. A read that began before the last write ended is dropped.
  const writesRef = useRef({ active: 0, lastEnd: 0 });
  const beginWrite = useCallback(() => {
    writesRef.current.active += 1;
    return () => { writesRef.current.active -= 1; writesRef.current.lastEnd = Date.now(); };
  }, []);

  const fetchEvent = useCallback(async () => {
    const started = Date.now();
    try {
      const data = (await apiRequest("GET /api/events/{id}", {
        params: { id: eventId },
        query: { inviteToken: inviteToken ?? undefined },
      })) as EventData & { locked?: boolean };
      if (writesRef.current.active > 0 || started < writesRef.current.lastEnd) return;
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

  // Poll for updates every 10s, while the tab is in view
  useEffect(() => {
    const id = setInterval(() => { if (!document.hidden) void fetchEvent(); }, 10_000);
    return () => clearInterval(id);
  }, [fetchEvent]);

  // Re-fetch on window focus
  useEffect(() => {
    const onFocus = () => fetchEvent();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [fetchEvent]);

  // ── Permissions ─────────────────────────────────────────────────────────────
  const perms = deriveEventPermissions(
    session?.user?.id ?? null,
    { ownerId: event?.ownerId ?? null, isPublic: !!event?.isPublic, isAdmin: !!event?.isAdmin },
    { isParticipant: !!session?.user && !!event?.players.some((p) => p.userId === session.user!.id) },
  );

  // ADR 0018: ?action=confirm-payment sends the organizer to the payments page.
  useEffect(() => {
    if (deepLinkAction === "confirm-payment" && deepLinkPlayer) window.location.href = `/events/${eventId}/payments`;
  }, [deepLinkAction, deepLinkPlayer, eventId]);

  // ADR 0018: the T-24h recruitment push asks the owner to share — honour it
  // once the event is loaded, without letting a background refetch reopen it.
  useEffect(() => {
    if (deepLinkAction !== "share" || !event || deepLinkShareHandled.current) return;
    deepLinkShareHandled.current = true;

    const details = {
      title: event.title,
      dateTime: new Date(event.dateTime),
      timezone: event.timezone,
      location: event.location,
      maxPlayers: event.maxPlayers,
      playerCount: event.players.length,
      url: shareableUrl(window.location),
    };
    const text = buildEventShareText(details, locale, {
      spotsLeft: (n) => t("spotsLeft", { n }),
      full: t("full"),
    });

    shareEvent({ title: details.title, text, url: details.url })
      .then((outcome) => { if (outcome === "copied") setSnackbar(t("linkCopiedFull")); })
      .catch(() => setSnackbar(t("shareCopyFailed")));
  }, [deepLinkAction, event, locale, t]);

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
      setSnackbar(apiErrorMessage(e, t("somethingWentWrong")));
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

  /**
   * Show an edit at once, then ask the server. Either way the page re-reads the server's
   * answer, so a refused edit rolls itself back; the error goes on to the caller to say so.
   */
  const saveField = async <T,>(patch: Partial<EventData>, save: () => Promise<T>): Promise<T> => {
    setEvent((e) => e ? { ...e, ...patch } : e);
    try { return await save(); } finally { fetchEvent(); }
  };

  const handleSaveTitle = (title: string) =>
    saveField({ title }, () => apiRequest("PUT /api/events/{id}/title", { params: { id: eventId }, body: { title } })).then(() => undefined);

  const handleSaveLocation = async (location: string) => {
    const data = await saveField({ location }, () => apiRequest("PUT /api/events/{id}/location", {
      params: { id: eventId }, body: { location },
    })) as { geocoded?: boolean } | null;
    if (location && !data?.geocoded) setSnackbar(t("locationNotGeocoded"));
  };

  const handleSaveDateTime = (dateTime: string, timezone: string) => {
    // The datetime-local value is in the event's timezone: send it as UTC.
    const utcIso = fromDateTimeLocalValue(dateTime, timezone);
    return saveField({ dateTime: utcIso, timezone }, () => apiRequest("PUT /api/events/{id}/datetime", {
      params: { id: eventId }, body: { dateTime: utcIso, timezone },
    })).then(() => undefined);
  };

  const handleSaveSport = (sport: string) =>
    saveField({ sport }, () => apiRequest("PUT /api/events/{id}/sport", { params: { id: eventId }, body: { sport } })).then(() => undefined);

  // ── Ownership ───────────────────────────────────────────────────────────────

  // Throws when the server says no: the header says so, and confirms a success in its own toast.
  const handleClaimOwnership = async () => {
    await apiRequest("POST /api/events/{id}/claim", { params: { id: eventId } });
    fetchEvent();
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

  const isAuthenticated = !!session?.user;
  const { isOwner, isAdmin, isOwnerless, canEditSettings, canEditTeams } = perms;

  // #463 high-intent: the signed-in viewer's answer, so the PushPromptBanner can render as a modal
  // while an answer is still pending and the game kicks off within 48h.
  const [myRsvp, setMyRsvp] = useMyRsvp(eventId, isAuthenticated);

  // Whether this is the next game (open or being played). Between a weekly game's end and its reset the roster
  // and the drawn teams are still the finished game's: they never show as the next game's.
  const nextPhase = useNextGamePhase(
    event ? Date.parse(event.dateTime) : 0, event?.durationMinutes ?? 0, !!parseRecurrenceRule(event?.recurrenceRule ?? null), !!cancelled,
  );

  // ── Loading / locked / not found states ─────────────────────────────────────

  if (isLoading) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        {/* One viewport tall at least, in this state and the next, so the footer is below the fold in both and never jumps into view. */}
        <Container maxWidth="md" sx={{ py: 4, minHeight: "100dvh" }}>
          <Stack spacing={3}>
            <HeaderSkeleton />
            {/* Only when a last game is known to exist (the page was told so, or this viewer has seen its recap here). */}
            {(hasLastGame || lastRecapShape(eventId) !== null) && <RecapSkeleton strip={lastRecapShape(eventId) === "strip"} />}
            {/* Only what will be there: as many places as the game has, and none for a game with no next game. */}
            {(!nextGameHint || ["open", "live", "signupsSoon"].includes(nextGameHint.phase)) && (
              <NextGameSkeleton maxPlayers={nextGameHint?.maxPlayers} headerOnly={nextGameHint?.phase === "signupsSoon"} />
            )}
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


  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4, minHeight: "100dvh" }}>
          <Stack spacing={3}>

            {inviteToken && event && (
              <InviteBanner token={inviteToken} eventId={event.id} onAccepted={fetchEvent} />
            )}

            <EventHeader
              eventId={eventId}
              event={event}
              sport={sport}
              gameDate={gameDate}
              canEditSettings={canEditSettings}
              isAuthenticated={isAuthenticated}
              isOwnerless={isOwnerless}
              isParticipant={!!session?.user?.id && event.players.some((p) => p.userId === session.user.id)}
              localMatches={localMatches}
              gameStatus={event.gameStatus}
              onSaveTitle={handleSaveTitle}
              onSaveLocation={handleSaveLocation}
              onSaveDateTime={handleSaveDateTime}
              onSaveSport={handleSaveSport}
              onClaimOwnership={handleClaimOwnership}
              onSignedIn={() => { refetchSession?.(); fetchEvent(); }}
              onCancelGame={() => setCancelConfirmOpen(true)}
            />

            {cancelled && <CancelledBanner canManage={canEditSettings} />}

            {/* Last game recap — for everyone (signed-out and non-players get the result).
                Seeded from the initial payload so nothing flashes before the client fetch. */}
            <EventRecap
              eventId={eventId}
              initialStatus={event?.postGameStatus ?? null}
              viewerName={session?.user?.name ?? null}
              isAuthenticated={isAuthenticated}
              canManage={isOwner || isAdmin}
              isRecurring={!!event.isRecurring}
              hasLastGame={event.hasLastGame}
              nextKickoff={event.dateTime}
              timezone={event.timezone}
              sport={sport}
              deepLinkAction={deepLinkAction}
              onBlockingChange={setRecapBlocking}
            />

            {/* #457 Push prompt banner — event-detail trigger. A "later" prompt: it comes after the recap, never above
                the title. #463 high-intent: render as a centered modal when the user has a pending RSVP and
                the event kicks off within 48h. */}
            <PushPromptBanner
              followCount={0}
              forceOnEventDetail={isAuthenticated}
              highIntent={isAuthenticated && event ? isHighIntentForPush(event.dateTime, myRsvp) : false}
            />

            <NextGame
              eventId={eventId} event={event} setEvent={setEvent} refetch={fetchEvent} beginWrite={beginWrite}
              viewer={session?.user ? { id: session.user.id, name: session.user.name } : null}
              perms={perms} rsvp={myRsvp} setRsvp={setMyRsvp} recapBlocking={recapBlocking}
              deepLinkAction={deepLinkAction} notify={setSnackbar}
              onSignedIn={() => { refetchSession?.(); fetchEvent(); }}
              draw={{
                hasTeams: !!(localMatches && localMatches.length > 0), isDrawing: isRandomizing, onDraw: doRandomize,
                onConfirmRedraw: () => setConfirmOpen(true), onConfirmEarlyDraw: () => setEarlyDrawOpen(true),
              }}
            />

            {/* Teams — shown below players after randomization, for the next game only */}
            {(nextPhase === "open" || nextPhase === "live") && localMatches && localMatches.length > 0 && (
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
          toastQueue={toastQueue}
          onToastDone={nextToast}
        />

        <CreatedShareNudge title={event.title} />
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
