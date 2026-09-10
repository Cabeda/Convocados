/* eslint-disable react-hooks/set-state-in-effect -- Async server data initializes local state. */
import { useCallback, useEffect, useState } from "react";
import { Box, Button, CircularProgress, Container, Stack, Typography } from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import HistoryIcon from "@mui/icons-material/History";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";
import { HistoryCardFull, type HistoryCardFullEntry } from "./HistoryCardFull";

export default function GameDetailPage({ eventId, historyId }: { eventId: string; historyId: string }) {
  const t = useT();
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  const [entry, setEntry] = useState<HistoryCardFullEntry | null>(null);
  const [title, setTitle] = useState("");
  const [ownerId, setOwnerId] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
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
  const isOwner = !!(session?.user && ownerId && session.user.id === ownerId);

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
    setTimezone(ev.timezone || "UTC");
    setEventLocation(ev.location ?? "");
    setEventLat(ev.latitude ?? null);
    setEventLng(ev.longitude ?? null);
    setEventPlayers((ev.players ?? []).map((p: { id: string; name: string }) => ({ id: p.id, name: p.name })));
    setEntry(detail);
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
