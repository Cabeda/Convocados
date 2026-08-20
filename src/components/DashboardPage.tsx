/* eslint-disable react-hooks/set-state-in-effect -- Sync-from-server pattern: server data initializes local state, async fetch responses set state. Common in this codebase. */
import React, { useState, useCallback, useEffect, useRef } from "react";
import {
  Container, Typography, Stack, Box, Button,
  CircularProgress, Alert, Divider, Accordion, AccordionSummary, AccordionDetails,
  IconButton, Tooltip, Paper, Chip,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import UnfollowIcon from "@mui/icons-material/VisibilityOff";
import PersonAddIcon from "@mui/icons-material/PersonAdd";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { PushPromptBanner } from "./PushPromptBanner";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";
import { GameCard, type GameSummary } from "./GameCard";

const POLL_INTERVAL = 30_000;
const HIGH_INTENT_HOURS = 48;

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

/** ADR 0025: dashboard panel surfaces at most the 3 nearest upcoming managed games. */
const MANAGED_SUGGESTIONS_GAMES = 3;

export default function DashboardPage() {
  const t = useT();
  const { data: session, isPending: sessionLoading } = useSession();

  const [owned, setOwned] = useState<GameSummary[]>([]);
  const [admin, setAdmin] = useState<GameSummary[]>([]);
  const [followed, setFollowed] = useState<GameSummary[]>([]);
  const [archivedOwned, setArchivedOwned] = useState<GameSummary[]>([]);
  const [archivedAdmin, setArchivedAdmin] = useState<GameSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ownedCursor, setOwnedCursor] = useState<string | null>(null);
  const [ownedHasMore, setOwnedHasMore] = useState(false);
  const [followedCursor, setFollowedCursor] = useState<string | null>(null);
  const [followedHasMore, setFollowedHasMore] = useState(false);
  const [loadingOwned, setLoadingOwned] = useState(false);
  const [loadingFollowed, setLoadingFollowed] = useState(false);
  const [managedSuggestions, setManagedSuggestions] = useState<ManagedGameSuggestions[]>([]);

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
    const data = await fetchGames();
    setOwned(data.owned);
    setAdmin(data.admin ?? []);
    setFollowed(data.followed);
    setArchivedOwned(data.archivedOwned ?? []);
    setArchivedAdmin(data.archivedAdmin ?? []);
    setOwnedCursor(data.ownedNextCursor);
    setOwnedHasMore(data.ownedHasMore);
    setFollowedCursor(data.followedNextCursor);
    setFollowedHasMore(data.followedHasMore);
    setManagedSuggestions(await fetchManagedSuggestions(data.owned, data.admin ?? []));
  }, [fetchGames, fetchManagedSuggestions]);

  useEffect(() => {
    if (!session?.user) return;
    loadData().then(() => setIsLoading(false));
  }, [session?.user, loadData]);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!session?.user) return;

    const poll = () => {
      if (document.visibilityState === "hidden") return;
      fetchGames().then((data) => {
        setOwned(data.owned);
        setAdmin(data.admin ?? []);
        setFollowed(data.followed);
        setArchivedOwned(data.archivedOwned ?? []);
        setArchivedAdmin(data.archivedAdmin ?? []);
        setOwnedCursor(data.ownedNextCursor);
        setOwnedHasMore(data.ownedHasMore);
        setFollowedCursor(data.followedNextCursor);
        setFollowedHasMore(data.followedHasMore);
        fetchManagedSuggestions(data.owned, data.admin ?? []).then(setManagedSuggestions).catch(() => {});
      }).catch(() => {});
    };

    pollRef.current = setInterval(poll, POLL_INTERVAL);

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        poll();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [session?.user, fetchGames, fetchManagedSuggestions]);

  const handleUnfollow = async (eventId: string) => {
    await fetch("/api/me/follows", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventId }),
    });
    setFollowed((prev) => prev.filter((g) => g.id !== eventId));
  };

  /** ADR 0025: one-tap invite from the dashboard panel. On success the chip is
   *  dropped from the panel (PlayerInvite pending on the server). */
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
    if (!ownedCursor || loadingOwned) return;
    setLoadingOwned(true);
    const data = await fetchGames(ownedCursor, null);
    setOwned((prev) => [...prev, ...data.owned]);
    setArchivedOwned((prev) => [...prev, ...(data.archivedOwned ?? [])]);
    setOwnedCursor(data.ownedNextCursor);
    setOwnedHasMore(data.ownedHasMore);
    setLoadingOwned(false);
  };

  const loadMoreFollowed = async () => {
    if (!followedCursor || loadingFollowed) return;
    setLoadingFollowed(true);
    const data = await fetchGames(null, followedCursor);
    setFollowed((prev) => [...prev, ...data.followed]);
    setFollowedCursor(data.followedNextCursor);
    setFollowedHasMore(data.followedHasMore);
    setLoadingFollowed(false);
  };

  // #136: high-intent = any non-archived game the user is involved in
  // starts within HIGH_INTENT_HOURS. Modals are harder to ignore than banners,
  // so the moment the user has a near-term game, we escalate the push prompt.
  // Snapshot "now" once per render via useState initializer so the lint
  // "no Date.now in render" rule doesn't fire and the calc stays consistent.
  // Hooks must be called before any early returns below.
  const [now] = React.useState(() => Date.now());
  const highIntent = React.useMemo(
    () => [...owned, ...admin, ...followed].some((g) => {
      const kickoff = new Date(g.dateTime).getTime();
      const hoursUntil = (kickoff - now) / (60 * 60 * 1000);
      return hoursUntil > 0 && hoursUntil <= HIGH_INTENT_HOURS;
    }),
    [owned, admin, followed, now],
  );

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
              {t("myGames")}
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

  const allArchived = [...archivedOwned, ...archivedAdmin];
  const hasActive = owned.length > 0 || admin.length > 0 || followed.length > 0;

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={4}>
            <Typography variant="h4" fontWeight={700}>{t("myGames")}</Typography>

            <PushPromptBanner
              followCount={hasActive ? 1 : 0}
              highIntent={hasActive && highIntent}
            />

            {isLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                {owned.length > 0 && (
                  <>
                    <Box>
                      <Typography variant="h6" fontWeight={600} gutterBottom>
                        {t("ownedGames")}
                      </Typography>
                      <Stack spacing={1.5}>
                        {owned.map((g) => <GameCard key={g.id} game={g} />)}
                        {ownedHasMore && (
                          <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
                            <Button variant="outlined" size="small" onClick={loadMoreOwned} disabled={loadingOwned}>
                              {loadingOwned ? t("loading") : t("loadMore")}
                            </Button>
                          </Box>
                        )}
                      </Stack>
                    </Box>
                    <Divider />
                  </>
                )}

                {admin.length > 0 && (
                  <>
                    <Box>
                      <Typography variant="h6" fontWeight={600} gutterBottom>
                        {t("adminGames")}
                      </Typography>
                      <Stack spacing={1.5}>
                        {admin.map((g) => <GameCard key={g.id} game={g} />)}
                      </Stack>
                    </Box>
                    <Divider />
                  </>
                )}

                {followed.length > 0 && (
                  <Box>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      {t("followedGames")}
                    </Typography>
                    <Stack spacing={1.5}>
                      {followed.map((g) => (
                        <Box key={g.id} sx={{ display: "flex", alignItems: "flex-start", gap: 1 }}>
                          <Box sx={{ flex: 1 }}>
                            <GameCard game={g} />
                          </Box>
                          <Tooltip title={t("unfollow")}>
                            <IconButton
                              size="small"
                              onClick={() => handleUnfollow(g.id)}
                              sx={{ mt: 1 }}
                            >
                              <UnfollowIcon fontSize="small" />
                            </IconButton>
                          </Tooltip>
                        </Box>
                      ))}
                      {followedHasMore && (
                        <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
                          <Button variant="outlined" size="small" onClick={loadMoreFollowed} disabled={loadingFollowed}>
                            {loadingFollowed ? t("loading") : t("loadMore")}
                          </Button>
                        </Box>
                      )}
                    </Stack>
                  </Box>
                )}

                {managedSuggestions.length > 0 && (
                  <>
                    <Box>
                      <Typography variant="h6" fontWeight={600} gutterBottom>
                        {t("gamesYouMightJoin")}
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
                    <Divider />
                  </>
                )}

                {!hasActive && (
                  <Alert severity="info">{t("noFollowedGames")}</Alert>
                )}

                {allArchived.length > 0 && (
                  <>
                    <Divider />
                    <Accordion defaultExpanded={false} variant="outlined" sx={{ borderRadius: 2, "&:before": { display: "none" } }}>
                      <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                        <Typography variant="h6" fontWeight={600}>
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
              </>
            )}
          </Stack>
        </Container>
      </ResponsiveLayout>
    </ThemeModeProvider>
  );
}
