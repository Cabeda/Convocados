import React, { useState, useCallback, useEffect } from "react";
import {
  Container, Typography, Stack, Box, Button,
  CircularProgress, Alert, Divider, Accordion, AccordionSummary, AccordionDetails,
} from "@mui/material";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { ThemeModeProvider } from "./ThemeModeProvider";
import { ResponsiveLayout } from "./ResponsiveLayout";
import { useT } from "~/lib/useT";
import { useSession } from "~/lib/auth.client";
import { GameCard, type GameSummary } from "./GameCard";

interface DashboardData {
  owned: GameSummary[];
  joined: GameSummary[];
  archivedOwned: GameSummary[];
  archivedJoined: GameSummary[];
  ownedNextCursor: string | null;
  ownedHasMore: boolean;
  joinedNextCursor: string | null;
  joinedHasMore: boolean;
}

export default function DashboardPage() {
  const t = useT();
  const { data: session, isPending: sessionLoading } = useSession();

  const [owned, setOwned] = useState<GameSummary[]>([]);
  const [joined, setJoined] = useState<GameSummary[]>([]);
  const [archivedOwned, setArchivedOwned] = useState<GameSummary[]>([]);
  const [archivedJoined, setArchivedJoined] = useState<GameSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [ownedCursor, setOwnedCursor] = useState<string | null>(null);
  const [ownedHasMore, setOwnedHasMore] = useState(false);
  const [joinedCursor, setJoinedCursor] = useState<string | null>(null);
  const [joinedHasMore, setJoinedHasMore] = useState(false);
  const [loadingOwned, setLoadingOwned] = useState(false);
  const [loadingJoined, setLoadingJoined] = useState(false);

  const fetchGames = useCallback(async (oc?: string | null, jc?: string | null) => {
    const params = new URLSearchParams();
    if (oc) params.set("ownedCursor", oc);
    if (jc) params.set("joinedCursor", jc);
    const res = await fetch(`/api/me/games?${params.toString()}`);
    return (await res.json()) as DashboardData;
  }, []);

  useEffect(() => {
    if (!session?.user) return;
    fetchGames().then((data) => {
      setOwned(data.owned);
      setJoined(data.joined);
      setArchivedOwned(data.archivedOwned ?? []);
      setArchivedJoined(data.archivedJoined ?? []);
      setOwnedCursor(data.ownedNextCursor);
      setOwnedHasMore(data.ownedHasMore);
      setJoinedCursor(data.joinedNextCursor);
      setJoinedHasMore(data.joinedHasMore);
      setIsLoading(false);
    });
  }, [session?.user, fetchGames]);

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

  const loadMoreJoined = async () => {
    if (!joinedCursor || loadingJoined) return;
    setLoadingJoined(true);
    const data = await fetchGames(null, joinedCursor);
    setJoined((prev) => [...prev, ...data.joined]);
    setArchivedJoined((prev) => [...prev, ...(data.archivedJoined ?? [])]);
    setJoinedCursor(data.joinedNextCursor);
    setJoinedHasMore(data.joinedHasMore);
    setLoadingJoined(false);
  };

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

  const allArchived = [...archivedOwned, ...archivedJoined];

  return (
    <ThemeModeProvider>
      <ResponsiveLayout>
        <Container maxWidth="md" sx={{ py: 4 }}>
          <Stack spacing={4}>
            <Typography variant="h4" fontWeight={700}>{t("myGames")}</Typography>

            {isLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            ) : (
              <>
                {/* Active: Owned games */}
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t("ownedGames")}
                  </Typography>
                  {owned.length > 0 ? (
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
                  ) : (
                    <Alert severity="info">{t("noOwnedGames")}</Alert>
                  )}
                </Box>

                <Divider />

                {/* Active: Joined games */}
                <Box>
                  <Typography variant="h6" fontWeight={600} gutterBottom>
                    {t("joinedGames")}
                  </Typography>
                  {joined.length > 0 ? (
                    <Stack spacing={1.5}>
                      {joined.map((g) => <GameCard key={g.id} game={g} />)}
                      {joinedHasMore && (
                        <Box sx={{ display: "flex", justifyContent: "center", pt: 1 }}>
                          <Button variant="outlined" size="small" onClick={loadMoreJoined} disabled={loadingJoined}>
                            {loadingJoined ? t("loading") : t("loadMore")}
                          </Button>
                        </Box>
                      )}
                    </Stack>
                  ) : (
                    <Alert severity="info">{t("noJoinedGames")}</Alert>
                  )}
                </Box>

                {/* Archived games (collapsible) */}
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
