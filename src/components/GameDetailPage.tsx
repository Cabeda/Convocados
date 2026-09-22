/* eslint-disable react-hooks/set-state-in-effect -- Async server data initializes local state. */
import { useCallback, useEffect, useState } from "react";
import { Alert, Box, Button, CircularProgress, Container, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import HistoryIcon from "@mui/icons-material/History";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";
import { HistoryCardFull, type HistoryCardFullEntry } from "./HistoryCardFull";
import { MatchEventsTimeline, type MatchEventSummary } from "./MatchEventsTimeline";
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
    const [evRes, entryRes, costRes] = await Promise.all([
      fetch(`/api/events/${eventId}`),
      fetch(`/api/events/${eventId}/history/${historyId}`),
      fetch(`/api/events/${eventId}/cost`).catch(() => null),
    ]);
    if (evRes.status === 404 || entryRes.status === 404) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const ev = await evRes.json();
    const detail = await entryRes.json();
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
    if (costRes && costRes.ok) setCost(await costRes.json());
    setLoading(false);

    const currentPlayers = (ev.players ?? []).map((p: { name: string; image?: string | null }) => ({ name: p.name, gamesPlayed: -1, userId: null, image: p.image ?? null }));
    Promise.all([
      fetch(`/api/events/${eventId}/known-players`).then((r) => r.json()).catch(() => ({ players: [] })),
      fetch(`/api/events/${eventId}/ratings`).then((r) => r.json()).catch(() => ({ data: [] })),
    ]).then(([kp, ratings]) => {
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
    const res = await fetch(`/api/events/${eventId}/history/${historyId}/match-events`);
    if (res.ok) {
      const body = await res.json();
      setMatchEvents(body.events ?? []);
    }
  }, [eventId, historyId]);

  const handleAddGoal = useCallback(async (draft: {
    scorerName: string; assistName: string | null; team: string;
    minute: number | null; ownGoal: boolean; penalty: boolean;
  }) => {
    setMatchEventsSaving(true);
    setMatchEventsError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/history/${historyId}/match-events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "goal", ...draft }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? t("matchEventsAddError"));
      }
      await refreshMatchEvents();
      // The goal changes the derived score, so pull the entry again too.
      const entryRes = await fetch(`/api/events/${eventId}/history/${historyId}`);
      if (entryRes.ok) setEntry(await entryRes.json());
    } finally {
      setMatchEventsSaving(false);
    }
  }, [eventId, historyId, refreshMatchEvents, t]);

  const handleRemoveGoal = useCallback(async (id: string) => {
    setMatchEventsSaving(true);
    setMatchEventsError(null);
    try {
      const res = await fetch(`/api/events/${eventId}/history/${historyId}/match-events/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? t("matchEventsAddError"));
      }
      await refreshMatchEvents();
      const entryRes = await fetch(`/api/events/${eventId}/history/${historyId}`);
      if (entryRes.ok) setEntry(await entryRes.json());
    } finally {
      setMatchEventsSaving(false);
    }
  }, [eventId, historyId, refreshMatchEvents, t]);

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
