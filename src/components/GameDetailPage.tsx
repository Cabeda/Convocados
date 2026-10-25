/* eslint-disable react-hooks/set-state-in-effect -- Async server data initializes local state. */
import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Container, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import HistoryIcon from "@mui/icons-material/History";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { apiRequest, ApiError } from "~/lib/api/client";
import { useSession } from "~/lib/auth.client";
import type { EventData } from "./event/types";
import { HistoryCardFull, type HistoryCardFullEntry } from "./HistoryCardFull";
import { MatchEventsTimeline, type MatchEventDraft, type MatchEventSummary } from "./MatchEventsTimeline";
import { deriveEventPermissions } from "~/lib/eventView";
import { isNameInTeamsSnapshot, isNameInPaymentsSnapshot } from "~/lib/snapshotParticipants";

/** Parse `teamsSnapshot` into the two sides with their player names. */
function parseTeams(snapshot: string | null | undefined): { name: string; players: string[] }[] {
  if (!snapshot) return [];
  try {
    const parsed = JSON.parse(snapshot) as { team: string; players: { name: string }[] }[];
    return parsed.map((t) => ({ name: t.team, players: (t.players ?? []).map((p) => p.name) }));
  } catch {
    return [];
  }
}

export default function GameDetailPage({ eventId, historyId }: { eventId: string; historyId: string }) {
  const t = useT();
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  const [entry, setEntry] = useState<HistoryCardFullEntry | null>(null);
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isPublic, setIsPublic] = useState(false);
  const [timezone, setTimezone] = useState("UTC");
  const [eventLocation, setEventLocation] = useState("");
  const [eventLat, setEventLat] = useState<number | null>(null);
  const [eventLng, setEventLng] = useState<number | null>(null);
  const [eventPlayers, setEventPlayers] = useState<{ id: string; name: string }[]>([]);
  const [cost, setCost] = useState<{ totalAmount: number; currency: string; payments: Array<{ playerName: string; amount: number; status: "paid" | "pending" }> } | null>(null);
  const [knownPlayers, setKnownPlayers] = useState<{ name: string; gamesPlayed: number; userId?: string | null; image?: string | null }[]>([]);
  const [playerRatings, setPlayerRatings] = useState<{ name: string; rating: number; gamesPlayed: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [matchEvents, setMatchEvents] = useState<MatchEventSummary[]>([]);
  const [matchEventsSaving, setMatchEventsSaving] = useState(false);
  const [matchEventsError, setMatchEventsError] = useState<string | null>(null);
  const isOwner = deriveEventPermissions(session?.user?.id ?? null, { ownerId, isPublic, isAdmin }).isOwner;

  const load = useCallback(async () => {
    const [evBody, entryBody, costBody] = await Promise.all([
      apiRequest("GET /api/events/{id}", { params: { id: eventId } }).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
      apiRequest("GET /api/events/{id}/history/{historyId}", { params: { id: eventId, historyId } }).catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }),
      apiRequest("GET /api/events/{id}/cost", { params: { id: eventId } }).catch(() => null),
    ]);
    if (!evBody || !entryBody) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const ev = evBody as EventData;
    const detail = entryBody as HistoryCardFullEntry;
    setTitle(ev.title);
    setOwnerId(ev.ownerId ?? null);
    setIsAdmin(!!ev.isAdmin);
    setIsPublic(!!ev.isPublic);
    setTimezone(ev.timezone || "UTC");
    setEventLocation(ev.location ?? "");
    setEventLat(ev.latitude ?? null);
    setEventLng(ev.longitude ?? null);
    setEventPlayers((ev.players ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
    setEntry(detail);
    setMatchEvents(detail.matchEvents ?? []);
    if (costBody) setCost(costBody as NonNullable<typeof cost>);
    setLoading(false);

    const currentPlayers = (ev.players ?? []).map((p: { name: string; image?: string | null }) => ({ name: p.name, gamesPlayed: -1, userId: null, image: p.image ?? null }));
    Promise.all([
      apiRequest("GET /api/events/{id}/known-players", { params: { id: eventId } }).catch(() => ({ players: [] })),
      apiRequest("GET /api/events/{id}/ratings", { params: { id: eventId } }).catch(() => ({ data: [] })),
    ]).then(([kpBody, ratingsBody]) => {
      const kp = kpBody as { players: Array<{ name: string; gamesPlayed: number; userId?: string | null; image?: string | null }> };
      const ratings = ratingsBody as { data: Array<{ name: string; rating: number; gamesPlayed: number }> };
      const allPlayersMap = new Map<string, { name: string; gamesPlayed: number; userId: string | null; image: string | null }>();
      currentPlayers.forEach((p: { name: string; gamesPlayed: number; userId: string | null; image: string | null }) => allPlayersMap.set(p.name.toLowerCase(), p));
      (kp.players ?? []).forEach((p: { name: string; gamesPlayed: number; userId?: string | null; image?: string | null }) => {
        if (!allPlayersMap.has(p.name.toLowerCase())) {
          allPlayersMap.set(p.name.toLowerCase(), { name: p.name, gamesPlayed: p.gamesPlayed, userId: p.userId ?? null, image: p.image ?? null });
        }
      });
      setKnownPlayers(Array.from(allPlayersMap.values()));
      setPlayerRatings(
        (ratings.data ?? []).map((r: { name: string; rating: number; gamesPlayed: number }) => ({ name: r.name, rating: r.rating, gamesPlayed: r.gamesPlayed })),
      );
    });
  }, [eventId, historyId]);

  useEffect(() => { void load(); }, [load]);

  const refreshMatchEvents = useCallback(async () => {
    const body = (await apiRequest("GET /api/events/{id}/history/{historyId}/match-events", {
      params: { id: eventId, historyId },
    }).catch(() => null)) as { events?: MatchEventSummary[] } | null;
    if (body) setMatchEvents(body.events ?? []);
  }, [eventId, historyId]);

  const reloadEntry = useCallback(async () => {
    const updated = (await apiRequest("GET /api/events/{id}/history/{historyId}", {
      params: { id: eventId, historyId },
    }).catch(() => null)) as HistoryCardFullEntry | null;
    if (updated) setEntry(updated);
  }, [eventId, historyId]);

  const handleAddGoal = useCallback(async (draft: MatchEventDraft) => {
    setMatchEventsSaving(true);
    setMatchEventsError(null);
    try {
      try {
        await apiRequest("POST /api/events/{id}/history/{historyId}/match-events", {
          params: { id: eventId, historyId },
          body: { type: "goal", ...draft, team: draft.team as "one" | "two" },
        });
      } catch (error) {
        throw new Error(error instanceof ApiError ? error.message : t("matchEventsAddError"), { cause: error });
      }
      await refreshMatchEvents();
      // The goal changes the derived score, so pull the entry again too.
      await reloadEntry();
    } finally {
      setMatchEventsSaving(false);
    }
  }, [eventId, historyId, refreshMatchEvents, reloadEntry, t]);

  const handleRemoveGoal = useCallback(async (id: string) => {
    setMatchEventsSaving(true);
    setMatchEventsError(null);
    try {
      try {
        await apiRequest("DELETE /api/events/{id}/history/{historyId}/match-events/{matchEventId}", {
          params: { id: eventId, historyId, matchEventId: id },
        });
      } catch (error) {
        throw new Error(error instanceof ApiError ? error.message : t("matchEventsAddError"), { cause: error });
      }
      await refreshMatchEvents();
      await reloadEntry();
    } finally {
      setMatchEventsSaving(false);
    }
  }, [eventId, historyId, refreshMatchEvents, reloadEntry, t]);

  // Logging goals mirrors the API's rule: owner/admin, or a participant of
  // this game (on its teams or payment roll).
  const userName = session?.user?.name ?? null;
  const isParticipantInGame = isOwner || isAdmin
    || (!!userName && entry ? (
      isNameInTeamsSnapshot(entry.teamsSnapshot, userName)
      || isNameInPaymentsSnapshot(entry.paymentsSnapshot, userName)
    ) : false);
  const canEditEvents = !!entry && entry.status === "played" && entry.scoringType !== "tennis" && isParticipantInGame;

  if (loading) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
          <CircularProgress />
        </Box>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  if (notFound || !entry) return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
          <Typography variant="h4" fontWeight={700} gutterBottom>{t("gameNotFound")}</Typography>
          <Button variant="contained" href={`/events/${eventId}/history`}>{t("backToGame")}</Button>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={3}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              <Button variant="outlined" startIcon={<ArrowBackIcon />} href={`/events/${eventId}/history`} size="small"
                sx={{ borderRadius: 2, textTransform: "none" }}>
                {t("viewHistory")}
              </Button>
              <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                <HistoryIcon color="primary" />
                <Typography variant="h5" fontWeight={700}>
                  {t("historyTitle", { title })}
                </Typography>
              </Box>
            </Box>

            {matchEventsError && (
              <Alert severity="error" onClose={() => setMatchEventsError(null)} sx={{ borderRadius: 2 }}>
                {matchEventsError}
              </Alert>
            )}

            <MatchEventsTimeline
              events={matchEvents}
              teams={parseTeams(entry.teamsSnapshot)}
              canEdit={canEditEvents}
              saving={matchEventsSaving}
              onAdd={canEditEvents ? handleAddGoal : undefined}
              onRemove={canEditEvents ? handleRemoveGoal : undefined}
              emptyPlayersHint={t("matchEventsNoPlayers")}
            />

            <HistoryCardFull
              entry={entry}
              eventId={eventId}
              event={{
                id: eventId,
                title,
                location: eventLocation,
                latitude: eventLat,
                longitude: eventLng,
                timezone,
                ownerId,
              }}
              cost={cost}
              onUpdate={(updated) => setEntry(updated)}
              onDelete={() => { window.location.href = `/events/${eventId}/history`; }}
              isAuthenticated={isAuthenticated}
              isOwner={isOwner}
              isAdmin={isAdmin}
              knownPlayers={knownPlayers}
              playerRatings={playerRatings}
              userName={session?.user?.name ?? null}
              eventPlayers={eventPlayers}
              onPaymentsConfigSaved={load}
            />
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
