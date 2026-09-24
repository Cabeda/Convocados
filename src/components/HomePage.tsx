/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Container, Typography, Stack, Box, Button,
  CircularProgress, Alert, Divider, Accordion, AccordionSummary, AccordionDetails,
  IconButton, Tooltip, Paper, Chip, Dialog, DialogTitle, DialogContent,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import UnfollowIcon from "@mui/icons-material/VisibilityOff";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlined";
import LocationOnIcon from "@mui/icons-material/LocationOn";
import AccessTimeIcon from "@mui/icons-material/AccessTime";
import PeopleIcon from "@mui/icons-material/People";
import PublicIcon from "@mui/icons-material/Public";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { PushPromptBanner } from "./PushPromptBanner";
import CreateEventForm from "./CreateEventForm";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";
import { useCountdown } from "./event/useCountdown";
import { getSportPreset } from "~/lib/sports";
import { formatDateInTz } from "~/lib/timezones";
import { detectLocale, type TFunction } from "~/lib/i18n";
import { GameCard, type GameSummary } from "./GameCard";

const POLL_INTERVAL = 30_000;
const HIGH_INTENT_HOURS = 48;

/** GET /api/me/home — the signed-in Home feed (ADR 0041). */
interface UpNextGame {
  id: string;
  title: string;
  location: string;
  dateTime: string;
  timezone: string;
  sport: string;
  maxPlayers: number;
  playerCount: number;
  isRecurring: boolean;
  status: string;
}

interface DiscoverGame {
  id: string;
  url: string;
  title: string;
  location: string;
  sport: string;
  dateTime: string;
  timezone?: string;
  maxPlayers: number;
  playerCount: number;
  spotsLeft: number;
  isRecurring: boolean;
  source?: string;
  ownerId?: string | null;
}

interface HomeData {
  upNext: UpNextGame[];
  discover: DiscoverGame[];
}

interface DashboardData {
  owned: GameSummary[];
  admin: GameSummary[];
  followed: GameSummary[];
  archivedOwned: GameSummary[];
  archivedAdmin: GameSummary[];
  ownedNextCursor: string | null;
  ownedHasMore: boolean;
  followedNextCursor: string | null;
  followedHasMore: boolean;
}

/** ADR 0025 co-play suggestion (subset of the /suggestions endpoint shape). */
interface DashboardSuggestion {
  userId: string;
  name: string;
  image?: string | null;
  gamesPlayed?: number;
  coPlayCount?: number;
  score?: number;
  invitedPending?: boolean;
}

interface ManagedGameSuggestions {
  game: GameSummary;
  suggestions: DashboardSuggestion[];
}

/** ADR 0025: panel surfaces at most the 3 nearest upcoming managed games. */
const MANAGED_SUGGESTIONS_GAMES = 3;

function formatKickoff(date: Date, locale: string, timezone: string) {
  return formatDateInTz(date, locale === "pt" ? "pt-PT" : "en-GB", timezone || "UTC", {
    weekday: "short", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Hero card for a game the user plays/organizes. Shows a live badge or a
 *  live-ticking countdown to kickoff. */
function UpNextCard({ game, locale, t }: { game: UpNextGame; locale: string; t: TFunction }) {
  const date = new Date(game.dateTime);
  const isLive = game.status === "in_progress";
  const countdown = useCountdown(date, t("gameTime"));
  const sportPreset = getSportPreset(game.sport);
  return (
    <Paper
      elevation={2}
      sx={{
        borderRadius: 3, p: 2.5,
        borderLeft: 4,
        borderColor: isLive ? "error.main" : "primary.main",
      }}
    >
      <Stack spacing={1}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
          <Typography variant="h6" fontWeight={700} noWrap sx={{ flex: 1 }}>
            <a href={`/events/${game.id}`} style={{ textDecoration: "none", color: "inherit" }}>
              {game.title}
            </a>
          </Typography>
          {isLive ? (
            <Chip label={t("liveNow")} color="error" size="small" />
          ) : (
            <Chip label={countdown} color="primary" size="small" variant="outlined" />
          )}
        </Box>
        <Stack direction="row" spacing={2} useFlexGap sx={{ flexWrap: "wrap" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <AccessTimeIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {formatKickoff(date, locale, game.timezone)}
            </Typography>
          </Box>
          {game.location && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <LocationOnIcon fontSize="small" color="action" />
              <Typography variant="body2" color="text.secondary" noWrap>
                {game.location}
              </Typography>
            </Box>
          )}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <PeopleIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary">
              {game.playerCount}/{game.maxPlayers}
            </Typography>
          </Box>
          <Chip label={t(sportPreset.labelKey as Parameters<typeof t>[0])} size="small" variant="outlined" color="primary" />
        </Stack>
      </Stack>
    </Paper>
  );
}

function DiscoverCard({ game, locale, t }: { game: DiscoverGame; locale: string; t: TFunction }) {
  const date = new Date(game.dateTime);
  const isFull = game.spotsLeft === 0;
  const sportPreset = getSportPreset(game.sport);
  return (
    <Paper elevation={2} sx={{ borderRadius: 3, p: 2.5, height: "100%", display: "flex", flexDirection: "column", gap: 1 }}>
      <Typography variant="subtitle1" fontWeight={700} noWrap>
        <a href={`/events/${game.id}`} style={{ textDecoration: "none", color: "inherit" }}>
          {game.title}
        </a>
      </Typography>
      <Stack spacing={0.5}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <AccessTimeIcon fontSize="small" color="action" />
          <Typography variant="body2" color="text.secondary">
            {formatKickoff(date, locale, game.timezone ?? "UTC")}
          </Typography>
        </Box>
        {game.location && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
            <LocationOnIcon fontSize="small" color="action" />
            <Typography variant="body2" color="text.secondary" noWrap>
              {game.location}
            </Typography>
          </Box>
        )}
        <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
          <PeopleIcon fontSize="small" color="action" />
          <Typography variant="body2" color="text.secondary">
            {game.playerCount}/{game.maxPlayers}
          </Typography>
          {isFull ? (
            <Chip label={t("full")} size="small" color="error" sx={{ ml: 0.5 }} />
          ) : (
            <Chip label={t("spotsLeft", { n: game.spotsLeft })} size="small" color="success" sx={{ ml: 0.5 }} />
          )}
        </Box>
      </Stack>
      <Box sx={{ mt: "auto", pt: 1, display: "flex", alignItems: "center", gap: 1 }}>
        <Chip label={t(sportPreset.labelKey as Parameters<typeof t>[0])} size="small" variant="outlined" color="primary" />
        <Button variant="contained" size="small" href={`/events/${game.id}`} sx={{ ml: "auto", borderRadius: 2 }}>
          {t("joinGame")}
        </Button>
      </Box>
    </Paper>
  );
}

export default function HomePage() {
  const t = useT();
  const locale = detectLocale();
  const { data: session, isPending: sessionLoading } = useSession();

  const [home, setHome] = useState<HomeData | null>(null);
  const [homeLoading, setHomeLoading] = useState(true);
  const [games, setGames] = useState<DashboardData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadingOwned, setLoadingOwned] = useState(false);
  const [loadingFollowed, setLoadingFollowed] = useState(false);
  const [managedSuggestions, setManagedSuggestions] = useState<ManagedGameSuggestions[]>([]);
  const [createOpen, setCreateOpen] = useState(false);

  const fetchHome = useCallback(async () => {
    const res = await fetch("/api/me/home");
    if (!res.ok) throw new Error("home fetch failed");
    return (await res.json()) as HomeData;
  }, []);

  const fetchGames = useCallback(async (oc?: string | null, fc?: string | null) => {
    const params = new URLSearchParams();
    if (oc) params.set("ownedCursor", oc);
    if (fc) params.set("followedCursor", fc);
    const res = await fetch(`/api/me/games?${params.toString()}`);
    return (await res.json()) as DashboardData;
  }, []);

  /** ADR 0025: fetch co-play invite suggestions for the 3 nearest upcoming
   *  managed (owned/admin) games. Returns games that actually have candidates. */
  const fetchManagedSuggestions = useCallback(async (ownedGames: GameSummary[], adminGames: GameSummary[]) => {
    const nowMs = Date.now();
    const managed = [...ownedGames, ...adminGames]
      .filter((g) => new Date(g.dateTime).getTime() > nowMs)
      .sort((a, b) => new Date(a.dateTime).getTime() - new Date(b.dateTime).getTime())
      .slice(0, MANAGED_SUGGESTIONS_GAMES);
    if (managed.length === 0) return [];
    const results = await Promise.all(managed.map(async (game) => {
      try {
        const res = await fetch(`/api/events/${game.id}/suggestions`);
        const json = await res.json().catch(() => ({ suggestions: [] }));
        const suggestions = Array.isArray(json?.suggestions) ? json.suggestions : [];
        return { game, suggestions };
      } catch {
        return { game, suggestions: [] as DashboardSuggestion[] };
      }
    }));
    return results.filter((r) => r.suggestions.length > 0);
  }, []);

  const loadData = useCallback(async () => {
    const [homeData, gamesData] = await Promise.all([fetchHome(), fetchGames()]);
    setHome(homeData);
    setGames(gamesData);
    setManagedSuggestions(await fetchManagedSuggestions(gamesData.owned, gamesData.admin ?? []));
  }, [fetchHome, fetchGames, fetchManagedSuggestions]);

  useEffect(() => {
    if (!session?.user) return;
    loadData()
      .catch(() => {})
      .finally(() => {
        setHomeLoading(false);
        setIsLoading(false);
      });
  }, [session?.user, loadData]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!session?.user) return;

    const poll = () => {
      if (document.visibilityState === "hidden") return;
      fetchHome().then(setHome).catch(() => {});
      fetchGames().then((data) => {
        setGames(data);
        fetchManagedSuggestions(data.owned, data.admin ?? []).then(setManagedSuggestions).catch(() => {});
      }).catch(() => {});
    };

    pollRef.current = setInterval(poll, POLL_INTERVAL);

    const onVisibility = () => {
      if (document.visibilityState === "visible") poll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session?.user, fetchHome, fetchGames, fetchManagedSuggestions]);

  const handleUnfollow = async (eventId: string) => {
    await fetch("/api/me/follows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId }),
    });
    setGames((prev) => (prev ? { ...prev, followed: prev.followed.filter((g) => g.id !== eventId) } : prev));
  };

  /** ADR 0025: one-tap invite from the suggestions panel. */
  const handleSuggestionInvite = async (eventId: string, userId: string) => {
    try {
      const res = await fetch(`/api/events/${eventId}/invites`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      if (res.ok) {
        setManagedSuggestions((prev) => prev.map((m) => ({
          ...m,
          suggestions: m.suggestions.filter((s) => s.userId !== userId),
        })));
      }
    } catch { /* network blip — panel stays as-is */ }
  };

  const loadMoreOwned = async () => {
    if (!games?.ownedNextCursor || loadingOwned) return;
    setLoadingOwned(true);
    const data = await fetchGames(games.ownedNextCursor, null);
    setGames((prev) => (prev ? {
      ...prev,
      owned: [...prev.owned, ...data.owned],
      archivedOwned: [...prev.archivedOwned, ...(data.archivedOwned ?? [])],
      ownedNextCursor: data.ownedNextCursor,
      ownedHasMore: data.ownedHasMore,
    } : prev));
    setLoadingOwned(false);
  };

  const loadMoreFollowed = async () => {
    if (!games?.followedNextCursor || loadingFollowed) return;
    setLoadingFollowed(true);
    const data = await fetchGames(null, games.followedNextCursor);
    setGames((prev) => (prev ? {
      ...prev,
      followed: [...prev.followed, ...data.followed],
      followedNextCursor: data.followedNextCursor,
      followedHasMore: data.followedHasMore,
    } : prev));
    setLoadingFollowed(false);
  };

  // #136: high-intent = any non-archived game the user is involved in starts
  // within HIGH_INTENT_HOURS. Snapshot "now" once per render so the calc is
  // stable and the lint rule against Date.now() in render does not fire.
  const [now] = React.useState(() => Date.now());
  const involved = games ? [...games.owned, ...games.admin, ...games.followed] : [];
  const highIntent = involved.some((g) => {
    const hoursUntil = (new Date(g.dateTime).getTime() - now) / (60 * 60 * 1000);
    return hoursUntil > 0 && hoursUntil <= HIGH_INTENT_HOURS;
  });

  if (sessionLoading) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
            <CircularProgress />
          </Box>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  if (!session?.user) {
    return (
      <ThemeModeProvider>
        <ResponsiveLayout>
          <Container maxWidth="sm" sx={{ py: 8, textAlign: "center" }}>
            <Typography variant="h5" fontWeight={700} gutterBottom>
              {t("home")}
            </Typography>
            <Typography color="text.secondary" gutterBottom>
              {t("signIn")}
            </Typography>
            <Button variant="contained" href="/auth/signin" sx={{ mt: 2 }}>
              {t("signIn")}
            </Button>
          </Container>
        </ResponsiveLayout>
      </ThemeModeProvider>
    );
  }

  const upNext = home?.upNext ?? [];
  const discover = home?.discover ?? [];
  const allArchived = [...(games?.archivedOwned ?? []), ...(games?.archivedAdmin ?? [])];
  const hasActive = !!games && (games.owned.length > 0 || games.admin.length > 0 || games.followed.length > 0);
  const nothingToShow = !homeLoading && upNext.length === 0 && discover.length === 0;

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={4}>
            <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 2 }}>
              <Typography variant="h4" fontWeight={700}>{t("home")}</Typography>
              <Button
                variant="contained"
                startIcon={<AddCircleOutlineIcon />}
                onClick={() => setCreateOpen(true)}
                sx={{ borderRadius: 2, flexShrink: 0 }}
              >
                {t("createGame")}
              </Button>
            </Box>

            <PushPromptBanner
              followCount={hasActive ? 1 : 0}
              highIntent={hasActive && highIntent}
            />

            {(homeLoading || isLoading) && !home ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            ) : nothingToShow ? (
              <Paper elevation={2} sx={{ borderRadius: 3, p: 4, textAlign: "center" }}>
                <Typography variant="h6" color="text.secondary" gutterBottom>
                  {t("noUpcomingGames")}
                </Typography>
                <Typography variant="body2" color="text.secondary" mb={2}>
                  {t("noDiscoverGames")}
                </Typography>
                <Stack direction="row" spacing={2} sx={{ justifyContent: "center" }}>
                  <Button variant="contained" onClick={() => setCreateOpen(true)}>{t("createGame")}</Button>
                  <Button variant="outlined" href="/public">{t("browseAllPublicGames")}</Button>
                </Stack>
              </Paper>
            ) : (
              <>
                {/* Up next — games the user plays or organizes */}
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t("upNext")}
                  </Typography>
                  {upNext.length > 0 ? (
                    <Stack spacing={1.5}>
                      {upNext.map((g) => <UpNextCard key={g.id} game={g} locale={locale} t={t} />)}
                    </Stack>
                  ) : (
                    <Alert severity="info">{t("noUpcomingGames")}</Alert>
                  )}
                </Box>

                {/* Discover — public games looking for players */}
                <Box>
                  <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1 }}>
                    <Typography variant="h6" fontWeight={600}>{t("discover")}</Typography>
                    <Button size="small" href="/public" startIcon={<PublicIcon fontSize="small" />}>
                      {t("browseAllPublicGames")}
                    </Button>
                  </Box>
                  {discover.length > 0 ? (
                    <Box
                      sx={{
                        display: "grid",
                        gridTemplateColumns: { xs: "1fr", sm: "1fr 1fr", md: "1fr 1fr 1fr" },
                        gap: 2,
                      }}
                    >
                      {discover.map((g) => <DiscoverCard key={g.id} game={g} locale={locale} t={t} />)}
                    </Box>
                  ) : (
                    <Typography variant="body2" color="text.secondary">
                      {t("noDiscoverGames")}
                    </Typography>
                  )}
                </Box>

                {/* ADR 0025 — recruitment suggestions for managed games */}
                {managedSuggestions.length > 0 && (
                  <Box>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      {t("dashboardSuggestedPlayers")}
                    </Typography>
                    <Stack spacing={1.5}>
                      {managedSuggestions.map(({ game, suggestions }) => (
                        <Paper key={game.id} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                          <Typography variant="subtitle2" fontWeight={600}>
                            <a href={`/events/${game.id}`} style={{ textDecoration: "none", color: "inherit" }}>
                              {game.title}
                            </a>
                          </Typography>
                          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, mt: 1 }}>
                            {suggestions.slice(0, 6).map((s) => (
                              <Chip
                                key={s.userId}
                                icon={<PersonAddIcon fontSize="small" />}
                                label={s.name}
                                variant="outlined"
                                size="small"
                                color="primary"
                                title={s.gamesPlayed ? `${s.gamesPlayed} games` : undefined}
                                onClick={() => handleSuggestionInvite(game.id, s.userId)}
                                sx={{ cursor: "pointer" }}
                              />
                            ))}
                          </Box>
                        </Paper>
                      ))}
                    </Stack>
                  </Box>
                )}

                {/* Manage my games — relationship groups, collapsed below the fold */}
                <Accordion variant="outlined" sx={{ borderRadius: 2, "&:before": { display: "none" } }}>
                  <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                    <Typography variant="h6" fontWeight={600}>{t("manageMyGames")}</Typography>
                  </AccordionSummary>
                  <AccordionDetails>
                    <Stack spacing={3}>
                      {games?.owned.length ? (
                        <Box>
                          <Typography variant="subtitle1" fontWeight={600} gutterBottom>{t("ownedGames")}</Typography>
                          <Stack spacing={1.5}>
                            {games.owned.map((g) => <GameCard key={g.id} game={g} />)}
                            {games.ownedHasMore && (
                              <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
                                <Button variant="outlined" size="small" onClick={loadMoreOwned} disabled={loadingOwned}>
                                  {loadingOwned ? t("loading") : t("loadMore")}
                                </Button>
                              </Box>
                            )}
                          </Stack>
                        </Box>
                      ) : null}

                      {games?.admin.length ? (
                        <Box>
                          <Typography variant="subtitle1" fontWeight={600} gutterBottom>{t("adminGames")}</Typography>
                          <Stack spacing={1.5}>
                            {games.admin.map((g) => <GameCard key={g.id} game={g} />)}
                          </Stack>
                        </Box>
                      ) : null}

                      {games?.followed.length ? (
                        <Box>
                          <Typography variant="subtitle1" fontWeight={600} gutterBottom>{t("followedGames")}</Typography>
                          <Stack spacing={1.5}>
                            {games.followed.map((g) => (
                              <Box key={g.id} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                                <Box sx={{ flex: 1 }}>
                                  <GameCard game={g} />
                                </Box>
                                <Tooltip title={t("unfollow")}>
                                  <IconButton size="small" onClick={() => handleUnfollow(g.id)} sx={{ mt: 1 }}>
                                    <UnfollowIcon fontSize="small" />
                                  </IconButton>
                                </Tooltip>
                              </Box>
                            ))}
                            {games.followedHasMore && (
                              <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
                                <Button variant="outlined" size="small" onClick={loadMoreFollowed} disabled={loadingFollowed}>
                                  {loadingFollowed ? t("loading") : t("loadMore")}
                                </Button>
                              </Box>
                            )}
                          </Stack>
                        </Box>
                      ) : null}

                      {!hasActive && <Alert severity="info">{t("noFollowedGames")}</Alert>}

                      {allArchived.length > 0 && (
                        <>
                          <Divider />
                          <Accordion variant="outlined" sx={{ borderRadius: 2, "&:before": { display: "none" } }}>
                            <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                              <Typography variant="subtitle1" fontWeight={600}>
                                {t("archivedGames")} ({allArchived.length})
                              </Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                              <Stack spacing={1.5}>
                                {allArchived.map((g) => <GameCard key={g.id} game={g} />)}
                              </Stack>
                            </AccordionDetails>
                          </Accordion>
                        </>
                      )}
                    </Stack>
                  </AccordionDetails>
                </Accordion>
              </>
            )}
          </Stack>
        </Container>

        <Dialog open={createOpen} onClose={() => setCreateOpen(false)} maxWidth="md" fullWidth>
          <DialogTitle>{t("createGame")}</DialogTitle>
          <DialogContent>
            <CreateEventForm bare />
          </DialogContent>
        </Dialog>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
